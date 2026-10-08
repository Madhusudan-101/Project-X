# graph.py
from dotenv import load_dotenv
import json
import os
from typing import TypedDict, Annotated, Sequence, List, Dict

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, ToolMessage, AIMessage
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from langchain_core.tools import tool
from operator import add as add_messages
import time

from pydantic import BaseModel, Field

from domains import DOMAIN_LABELS
from reporting import submit_report

load_dotenv(".env.local")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")


class QuestionFeedback(BaseModel):
    question: str
    feedback: str
    score: float = Field(ge=1, le=10)


class InterviewReport(BaseModel):
    """Structured grading output. Scores are 1-10; reporting.py rescales to 0-100."""
    overall_score: float = Field(ge=1, le=10)
    technical_score: float = Field(ge=1, le=10)
    communication_score: float = Field(ge=1, le=10)
    strengths: list[str]
    weaknesses: list[str]
    red_flags: list[str] = Field(description="Empty list if none were noted")
    per_question: list[QuestionFeedback]
    final_recommendation: str = Field(description="One of: Strong Hire, Hire, Borderline, No Hire")
    report_markdown: str = Field(description="The full written report with all required sections")

# -------------------- Domain-specific SDE interview topics --------------------
# These are TOPIC GUIDANCE for the LLM, not scripted questions - the interviewer
# phrases its own question about each topic based on the conversation so far,
# and may ask one natural follow-up before moving on.

QUESTION_TOPICS = {
    "ai_ml": [
        "Warm introduction - have the candidate tell you about their background, what they're passionate about "
        "in AI/ML, and what brought them to this interview.",

        "ML fundamentals - probe their understanding of supervised vs unsupervised vs reinforcement learning, "
        "ideally with a concrete example of when each is used in a real product.",

        "Overfitting - ask how they'd detect and address overfitting in a model they built; listen for specific "
        "techniques (regularization, cross-validation, dropout, more data, etc.).",

        "Productionizing ML - ask about a time they took a model from prototype/notebook to production, and how "
        "they handled challenges like data drift, latency, or scaling.",

        "Model tradeoffs - ask about the tradeoffs between using a large pretrained model (e.g. a transformer) "
        "versus training a smaller custom model for a specific use case, and how they'd decide.",

        "Closing - thank them for their answers and invite them to ask you anything about the company, the "
        "role, or the team.",
    ],
    "web_dev": [
        "Warm introduction - have the candidate tell you about their background, what they're passionate about "
        "in web development, and what brought them to this interview.",

        "Browser fundamentals - ask them to walk through what happens between typing a URL and the page fully "
        "rendering on screen.",

        "API design - ask about the difference between REST and GraphQL, the tradeoffs, and when they'd pick "
        "one over the other.",

        "Debugging story - ask about a challenging bug or performance issue they debugged in a web app, and how "
        "they found and fixed it.",

        "Architecture - ask how they'd design the frontend architecture for a real-time collaborative app like "
        "Google Docs, and how they'd keep multiple users' views in sync.",

        "Closing - thank them for their answers and invite them to ask you anything about the company, the "
        "role, or the team.",
    ],
    "dsa": [
        "Warm introduction - have the candidate tell you about their background, their experience with data "
        "structures & algorithms, and what brought them to this interview.",

        "Classic array problem - ask them to describe how they'd find two numbers in an array that add up to a "
        "target value (two-sum style), and its time complexity.",

        "Data structure tradeoffs - ask them to compare a hash map, a balanced BST, and a heap, and describe a "
        "scenario where each would be the best choice.",

        "Hardest problem - ask about the hardest algorithmic problem they've solved, their approach, and how "
        "they optimized it.",

        "Linked list cycle detection - ask how they'd detect a cycle in a linked list, ideally using only O(1) "
        "extra space (Floyd's algorithm).",

        "Closing - thank them for their answers and invite them to ask you anything about the company, the "
        "role, or the team.",
    ],
}

# Reference concepts per domain, used to (a) ground the interviewer's follow-up
# questions so it can push for real depth instead of accepting buzzwords, and
# (b) let the report grader check technical correctness against something concrete.
DOMAIN_KNOWLEDGE = {
    "ai_ml": (
        "Bias-variance tradeoff; regularization (L1/L2, dropout); cross-validation; gradient descent variants; "
        "batch/layer normalization; overfitting fixes (early stopping, more data, simpler model, augmentation); "
        "classical ML vs deep learning use cases; transfer learning and fine-tuning; evaluation metrics beyond "
        "accuracy (precision/recall/F1/AUC); data drift and monitoring in production; latency/throughput "
        "tradeoffs for serving models; embeddings and vector search basics."
    ),
    "web_dev": (
        "DNS resolution, TCP handshake, TLS; HTTP request/response cycle; critical rendering path; "
        "render-blocking CSS/JS; virtual DOM vs real DOM; REST statelessness vs GraphQL single-endpoint and "
        "over/under-fetching tradeoffs; caching layers (browser, CDN, server); CORS; WebSockets vs polling vs "
        "SSE for real-time sync; operational transforms/CRDTs for collaborative editing; session vs JWT auth; "
        "performance profiling tools."
    ),
    "dsa": (
        "Big-O time/space complexity; hash map O(1) average lookup and collision handling; BST balancing "
        "(AVL/red-black) and O(log n) guarantees; heap O(log n) insert/extract for priority queues; two-pointer "
        "and sliding window techniques; Floyd's cycle detection (tortoise and hare); recursion vs iteration "
        "tradeoffs; dynamic programming vs greedy; BFS/DFS use cases."
    ),
}


def normalize_domain(raw_text: str) -> str | None:
    """Map free-form candidate speech to one of our known domain keys."""
    text = (raw_text or "").lower()
    if any(k in text for k in ["ai", "ml", "machine learning", "artificial intelligence"]):
        return "ai_ml"
    if any(k in text for k in ["web", "frontend", "front end", "backend", "back end", "full stack"]):
        return "web_dev"
    if any(k in text for k in ["dsa", "data structure", "algorithm", "competitive programming", "leetcode"]):
        return "dsa"
    return None


# -------------------- Build your Interview RAG pipeline --------------------
def create_workflow(room_name: str | None = None, initial_domain: str | None = None):
    # Defensive re-check even though the token server already validates -
    # a bad/unknown value here should behave like "not chosen yet", not crash.
    initial_domain = initial_domain if initial_domain in DOMAIN_LABELS else None

    # max_retries=1 (i.e. no SDK-level retries - see the langchain-google-genai
    # docstring on this field) because the SDK's default of 6 does its own
    # exponential backoff internally (can silently eat 30s+ during a Gemini
    # blip) before call_llm's own retry loop below even gets a chance to run.
    # That's incompatible with a fast, conversational turnaround.
    llm = ChatGoogleGenerativeAI(model=GEMINI_MODEL, temperature=0.7, max_retries=1)
    # Separate, tool-free LLM used only for generating the final performance report
    report_llm = ChatGoogleGenerativeAI(model=GEMINI_MODEL, temperature=0.3, max_retries=1)
    # Company Q&A is optional. The vector store is built ahead of time by
    # ingest.py (never here: every interview is its own process, so ingesting
    # on first use raced and duplicated chunks). No store -> no company tool.
    retriever = None
    persist_directory = os.getenv("CHROMA_DIR", "./chroma_store")
    if os.path.isdir(persist_directory):
        try:
            vectorstore = Chroma(
                embedding_function=GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001"),
                persist_directory=persist_directory,
                collection_name="company_info",
            )
            if vectorstore._collection.count() > 0:
                retriever = vectorstore.as_retriever(search_type="similarity", search_kwargs={"k": 2})
        except Exception as exc:
            print(f"Company info store unavailable, continuing without it: {exc}")
    started_at = time.monotonic()

    @tool
    def company_info_tool(query: str) -> str:
        """Searches the company information document and returns relevant chunks about the company."""
        if retriever is None:
            return "No company information is available."
        docs = retriever.invoke(query)
        if not docs:
            return "No relevant information found in the company documents."
        result_parts = []
        for i, doc in enumerate(docs):
            info_number = i + 1
            content = doc.page_content
            formatted_info = f"Info {info_number}:\n{content}"
            result_parts.append(formatted_info)
        return "\n\n".join(result_parts)

    @tool
    def record_answer_tool(question: str, answer: str) -> str:
        """Records the question you asked (in your own words) and the candidate's full answer to it (including
        any follow-up exchange), for the final report. Call this once you're ready to move on from the current topic."""
        return "Recorded successfully!"

    @tool
    def select_domain_tool(domain: str) -> str:
        """Call this once the candidate has told you which interview domain they want: AI/ML, Web Development, or DSA (Data Structures & Algorithms)."""
        return f"Domain selection received: {domain}"

    tools = [record_answer_tool, select_domain_tool] + ([company_info_tool] if retriever else [])
    llm = llm.bind_tools(tools)

    class InterviewState(TypedDict):
        messages: Annotated[Sequence[BaseMessage], add_messages]
        domain: str
        question_index: int
        topic_turn_count: int
        qa_pairs: List[Dict[str, str]]
        report_generated: bool

    def generate_performance_report(domain: str, qa_pairs: List[Dict[str, str]], partial: bool = False) -> str:
        """Builds a detailed performance report from the candidate's recorded Q&A exchanges."""
        qa_lines = []
        for i, pair in enumerate(qa_pairs):
            qa_lines.append(f"Q{i + 1}: {pair.get('question', '')}\nA{i + 1}: {pair.get('answer', '')}")
        qa_block = "\n\n".join(qa_lines) if qa_lines else "(no questions were answered)"

        partial_note = (
            "IMPORTANT: The candidate disconnected before completing the full interview - only the "
            "topics below were actually covered. Grade strictly on what was answered; do not penalize "
            "for topics that were never reached, and note in the report that this was a partial interview.\n\n"
            if partial else ""
        )

        report_prompt = (
            f"You are a strict, rigorous technical interviewer evaluating a candidate for a Software "
            f"Development Engineer (SDE) role in the {DOMAIN_LABELS[domain]} domain. Grade critically - do not "
            f"default to being lenient or encouraging in your scoring, even though the live interview tone was "
            f"warm and conversational.\n\n"
            f"{partial_note}"
            f"Reference concepts a strong candidate should demonstrate real depth in (use these to check "
            f"technical correctness, not just whether the topic was mentioned):\n{DOMAIN_KNOWLEDGE[domain]}\n\n"
            f"Full interview transcript:\n\n{qa_block}\n\n"
            "Score using this rubric:\n"
            "9-10: Exceptional depth, technically correct, specific real examples, clearly beyond surface level.\n"
            "7-8: Solid understanding, mostly correct, reasonably specific.\n"
            "5-6: Adequate but shallow - some correct points but lacking depth or specifics.\n"
            "3-4: Significant gaps - vague or buzzword-heavy answers, or notable inaccuracies.\n"
            "1-2: Mostly incorrect, evasive, or unable to substantiate claims.\n\n"
            "Fill every field. report_markdown must be a detailed, well-structured written report with the following sections:\n"
            "1. Overall Score (out of 10), with the score explicitly justified against the rubric above\n"
            "2. Technical Knowledge Assessment (check correctness against the reference concepts, not just topic coverage)\n"
            "3. Communication & Clarity Assessment\n"
            "4. Strengths (bullet points)\n"
            "5. Areas for Improvement (bullet points)\n"
            "6. Red Flags (any buzzword-only answers, technical inaccuracies, evasiveness, or contradictions "
            "you noticed in the transcript - write 'None noted' if there genuinely were none)\n"
            "7. Per-Question Feedback (short note on each answer)\n"
            "8. Final Recommendation (Strong Hire / Hire / Borderline / No Hire) with justification\n\n"
            "Be honest, specific, and constructive - but do not inflate the score. Base it strictly on what the "
            "candidate actually demonstrated, not on effort or confidence alone."
        )

        payload: dict = {
            "room_id": room_name,
            "partial": partial,
            "transcript": qa_block,
            "duration_seconds": int(time.monotonic() - started_at),
        }
        try:
            graded = report_llm.with_structured_output(InterviewReport).invoke([
                SystemMessage(content="You are a strict, rigorous expert technical interview evaluator who does not inflate scores."),
                HumanMessage(content=report_prompt),
            ])
            payload.update(
                overall_score=graded.overall_score * 10,
                technical_score=graded.technical_score * 10,
                communication_score=graded.communication_score * 10,
                strengths=graded.strengths,
                weaknesses=graded.weaknesses,
                red_flags=graded.red_flags,
                per_question=[q.model_dump() for q in graded.per_question],
                final_recommendation=graded.final_recommendation,
                report_markdown=graded.report_markdown,
            )
        except Exception as exc:
            # A transient failure here would otherwise lose the entire completed
            # interview at the final step; still submit the transcript.
            print(f"Report generation failed, submitting transcript only: {exc}")
            payload["report_markdown"] = (
                "Automated report generation failed due to a temporary error. "
                "Your transcript was saved."
            )

        submit_report(payload)
        return payload.get("report_markdown") or ""

    def decide_next_action(state: InterviewState) -> str:
        """Decide what to do next: tool_executor or end"""
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls and len(last.tool_calls) > 0:
            return "tool_executor"
        return "end"

    def call_llm(state: InterviewState) -> InterviewState:
        """Main LLM call that handles the interview conversation."""
        # domain is normally only set once select_domain_tool runs (mid-call state
        # update, not persisted by this node), so on every call before that we fall
        # back to whatever was chosen up front on the setup screen, if anything.
        domain = state.get("domain") or initial_domain or ""
        question_index = state.get("question_index", 0)
        topic_turn_count = state.get("topic_turn_count", 0)
        qa_pairs = state.get("qa_pairs", [])
        report_generated = state.get("report_generated", False)
        in_topic_loop = bool(domain) and not report_generated and question_index < len(QUESTION_TOPICS[domain])

        if not domain:
            # No domain chosen yet - ask the candidate to pick one
            system_prompt = (
                "You are a professional interviewer conducting a technical job interview for a Software "
                "Development Engineer (SDE) role. Greet the candidate warmly and ask them which domain they'd "
                "like to be interviewed in: AI/ML, Web Development, or Data Structures & Algorithms (DSA). "
                "Once the candidate tells you their choice, call select_domain_tool with their answer. "
                "Do not ask any technical questions yet - only greet them and ask for their domain choice."
            )
        elif in_topic_loop:
            topic = QUESTION_TOPICS[domain][question_index]
            knowledge = DOMAIN_KNOWLEDGE[domain]

            if topic_turn_count == 0:
                progression_rule = (
                    "This is a fresh topic. Ask your own original, natural-sounding question about it - do not "
                    "recite a script, phrase it yourself based on the conversation so far."
                )
            elif topic_turn_count in (1, 2):
                progression_rule = (
                    "The candidate has responded. Judge their answer critically against the reference concepts "
                    "below. If they used buzzwords or jargon without actually explaining them, gave a vague or "
                    "generic answer, skipped past the hard part of the question, made a technically incorrect "
                    "claim, or contradicted something they said earlier in the interview, ask a pointed "
                    "follow-up: push for a concrete example, a specific number or mechanism, or ask them to "
                    "correct/clarify the discrepancy. Do not let a surface-level answer pass as complete. If "
                    "their answer was already accurate, specific, and demonstrates real depth, skip the "
                    "follow-up and call record_answer_tool now."
                )
            else:
                progression_rule = (
                    "You've probed this topic enough (main question plus follow-ups). Call record_answer_tool "
                    "now with the question you asked (in your own words) and a summary of everything the "
                    "candidate said on this topic - explicitly note in the summary any buzzword-only answers, "
                    "technical inaccuracies, or contradictions you noticed, so they can be weighed in scoring. "
                    "Then the interview will move on."
                )

            system_prompt = (
                f"You are a rigorous, skeptical technical interviewer conducting an SDE interview in the "
                f"{DOMAIN_LABELS[domain]} domain. Do not accept vague, buzzword-heavy, or generic answers at "
                f"face value - probe for specifics, real examples, and correctness, the way a strong technical "
                f"panel interviewer would.\n\n"
                f"Reference concepts for this domain (use these to judge depth and catch wrong/BS answers - do "
                f"not read this list aloud):\n{knowledge}\n\n"
                f"Current topic to explore: {topic}\n\n{progression_rule}\n\n"
                "IMPORTANT ROUTING RULES:\n"
                + (
                    "- If the candidate asks about the company (mission, culture, revenue, etc.), use the "
                    "company_info_tool to find relevant information instead of asking your question again.\n"
                    if retriever else
                    "- If the candidate asks about the company, say you don't have those details and suggest "
                    "they check the Mirracle platform, then continue with your question.\n"
                ) +
                
                "- When you're ready to move on, call record_answer_tool with the question you asked and a "
                "clear summary of the candidate's full response (including any follow-up exchange).\n"
                "- Be conversational, professional, and encouraging.\n"
                "- Only cover ONE topic per turn - do not jump ahead to the next topic.\n"
                "- Sound like a real person in the room, not a checklist: briefly react to what they just said "
                "(e.g. \"Got it\", \"Interesting approach\", \"That makes sense\") before asking your next "
                "question or follow-up. Vary your phrasing turn to turn - don't reuse the same transition twice "
                "in a row. Keep it to a sentence or two of reaction, not a monologue."
            )
        elif not report_generated:
            # All topics covered - generate the report deterministically (not via LLM tool call).
            # The last recorded pair is always the "Closing" topic (invite questions about the
            # company/role) - it's not a technical question, so it's excluded here to avoid the
            # report grading "any questions for me?" against the technical rubric.
            graded_qa_pairs = qa_pairs[:-1] if qa_pairs else qa_pairs
            report_text = generate_performance_report(domain, graded_qa_pairs)
            farewell = AIMessage(
                content=(
                    "Thank you so much for completing the interview! That wraps up all of our questions. "
                    "I've finished evaluating your responses and prepared a detailed performance report for "
                    "you to review on your dashboard. Best of luck, and thank you again for your time today!"
                )
            )
            return {"messages": [farewell], "report_generated": True}
        else:
            # Interview is done - allow closing chit-chat / company questions only
            system_prompt = (
                "The interview is complete and the performance report has already been generated. "
                "Politely wrap up the conversation. If the candidate asks anything about the company, use the "
                "company_info_tool to answer (if you have no such tool, say you don't have those details). "
                "Do not ask any more interview questions."
            )

        history = [m for m in state["messages"] if not isinstance(m, SystemMessage)]
        if not history:
            # Gemini requires at least one non-system message; seed the very
            # first turn so the LLM has something to respond to.
            history = [HumanMessage(content="(The candidate has just joined. Begin the interview.)")]

        msgs = [SystemMessage(content=system_prompt)] + history
        message = None
        last_exc = None
        # Gemini's free tier returns transient 429/503s under load reasonably
        # often - retrying a couple times with backoff clears most of them,
        # instead of burning the candidate's whole turn on a filler line.
        for attempt in range(3):
            try:
                message = llm.invoke(msgs)
                break
            except Exception as exc:
                last_exc = exc
                if attempt < 2:
                    print(f"LLM call failed (attempt {attempt + 1}/3), retrying: {exc}")
                    time.sleep(1.5 * (attempt + 1))

        if message is None:
            # All retries exhausted - degrade gracefully rather than crashing
            # the whole interview session.
            print(f"LLM call failed after retries, degrading gracefully: {last_exc}")
            message = AIMessage(
                content="Sorry, I had a brief technical hiccup there - could you repeat that for me?"
            )

        updates = {"messages": [message]}
        if in_topic_loop and not getattr(message, "tool_calls", None):
            # The LLM asked something (main question or a follow-up) rather than
            # recording yet - track that so we know when to force a wrap-up.
            updates["topic_turn_count"] = topic_turn_count + 1

        return updates

    def tool_executor(state: InterviewState) -> InterviewState:
        """Execute tool calls from the LLM's response and update interview progress state."""
        tool_calls = state["messages"][-1].tool_calls
        results = []
        state_updates = {}

        for tool_call in tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call.get("args", {})

            print(f"Running tool: {tool_name}")

            if tool_name == "company_info_tool":
                result = company_info_tool.invoke(tool_args)

            elif tool_name == "select_domain_tool":
                normalized = normalize_domain(tool_args.get("domain", ""))
                if normalized:
                    state_updates["domain"] = normalized
                    state_updates["question_index"] = 0
                    state_updates["topic_turn_count"] = 0
                    state_updates["qa_pairs"] = []
                    result = f"Domain set to {DOMAIN_LABELS[normalized]}."
                else:
                    result = (
                        "Could not recognize that domain. Please ask the candidate to choose one of: "
                        "AI/ML, Web Development, or DSA (Data Structures & Algorithms)."
                    )

            elif tool_name == "record_answer_tool":
                question_text = tool_args.get("question", "")
                answer_text = tool_args.get("answer", "")
                result = record_answer_tool.invoke({"question": question_text, "answer": answer_text})
                current_index = state.get("question_index", 0)
                current_qa = list(state.get("qa_pairs", []))
                current_qa.append({"question": question_text, "answer": answer_text})
                state_updates["qa_pairs"] = current_qa
                state_updates["question_index"] = current_index + 1
                state_updates["topic_turn_count"] = 0

            else:
                result = f"Unknown tool: {tool_name}"

            tool_message = ToolMessage(
                tool_call_id=tool_call["id"],
                name=tool_name,
                content=str(result),
            )
            results.append(tool_message)

        print("All tools finished running.")
        return {"messages": results, **state_updates}

    # Build the interview graph
    graph = StateGraph(InterviewState)

    graph.add_node("llm", call_llm)
    graph.add_node("tool_executor", tool_executor)

    graph.set_entry_point("llm")

    graph.add_conditional_edges(
        "llm",
        decide_next_action,
        {
            "tool_executor": "tool_executor",
            "end": END,
        },
    )

    graph.add_edge("tool_executor", "llm")

    # A checkpointer is required for state (domain, question_index,
    # topic_turn_count, qa_pairs, report_generated) to survive across turns.
    # livekit-plugins-langchain's LLMAdapter calls astream() fresh for every
    # single conversational turn, passing only {"messages": [...]} as input -
    # without a checkpointer + thread_id, every other field silently resets
    # to its default each turn, so the interview could never advance past the
    # first topic or reach the per-answer follow-up logic. The caller (agent.py)
    # supplies the thread_id (room name) via the LLMAdapter's `config`.
    #
    # generate_performance_report is also returned so agent.py can produce a
    # partial report if the candidate disconnects before the graph's own
    # "all topics done" branch would have generated one.
    compiled = graph.compile(checkpointer=InMemorySaver())
    return compiled, generate_performance_report
