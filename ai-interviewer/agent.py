# agent.py
import asyncio
import json
import os

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import (
    langchain,   # <-- this is key
    cartesia,
    deepgram,
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from graph import create_workflow  # <-- our compiled LangGraph app

load_dotenv(".env.local")

class InterviewAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=(
            "You are a professional interviewer conducting a job interview. "
            "The LangGraph workflow will drive the conversation flow. "
            "Simply speak the questions and responses as they come from the graph. "
            "Be conversational, professional, and helpful throughout the interview process."
        ))

async def _end_interview(ctx: agents.JobContext) -> None:
    print("Interview time limit reached, closing room")
    try:
        from livekit import api
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.job.room.name))
    except Exception as exc:
        print(f"delete_room failed, shutting down job instead: {exc}")
        ctx.shutdown(reason="time limit")


async def entrypoint(ctx: agents.JobContext):
    # 1) Build/compile the LangGraph app (Runnable)
    # ctx.job.room.name/.metadata are available immediately from job dispatch
    # info, unlike ctx.room which is only populated once connected.
    # The Mirracle backend stamps domain / user_id / max_minutes into the room
    # metadata when it creates the room (see POST /candidate/ai-interview/session).
    meta: dict = {}
    try:
        meta = json.loads(ctx.job.room.metadata or "{}")
    except json.JSONDecodeError:
        pass
    initial_domain = meta.get("domain")
    try:
        max_minutes = int(meta.get("max_minutes") or os.getenv("AI_INTERVIEW_MAX_MINUTES", "20"))
    except ValueError:
        max_minutes = 20
    interview_workflow, generate_report = create_workflow(
        room_name=ctx.job.room.name, initial_domain=initial_domain
    )

    # 2) Wrap it as an LLM for LiveKit via the LangChain plugin
    #    (LLMAdapter knows how to drive LangGraph workflows as an LLM stream)
    # thread_id ties every turn in this room back to the same checkpointed
    # graph state (see the checkpointer note in graph.py) - without it the
    # interview's topic/follow-up progress resets on every single turn.
    thread_config = {"configurable": {"thread_id": ctx.job.room.name}}
    lg_llm = langchain.LLMAdapter(graph=interview_workflow, config=thread_config)

    # 3) Configure the rest of the realtime pipeline
    # Audio-only (no video avatar) - the avatar's lip-sync rendering added
    # several extra seconds of latency on top of LLM+TTS, which was pushing
    # replies past a ~10s turnaround. min/max_endpointing_delay are trimmed
    # from the library defaults (0.4s/6.0s) so the agent commits the user's
    # turn and starts generating sooner instead of waiting on a long pause.
    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=lg_llm,  # <-- use the adapter here instead of openai.LLM(...)
        tts=cartesia.TTS(model="sonic-2", voice="f786b574-daa5-4673-aa0c-cbe3e8534c02"),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
        min_endpointing_delay=0.3,
        max_endpointing_delay=2.5,
    )

    async def generate_partial_report_on_early_exit() -> None:
        # The graph only generates a report once every topic (including
        # Closing) has been recorded. If the candidate disconnects before
        # that, grade whatever was actually answered instead of leaving the
        # candidate with nothing - the frontend would otherwise just poll
        # /report until it times out.
        try:
            snapshot = interview_workflow.get_state(thread_config)
            values = snapshot.values or {}
            if values.get("report_generated"):
                return
            domain = values.get("domain") or initial_domain
            qa_pairs = values.get("qa_pairs") or []
            if not domain or not qa_pairs:
                return
            # Blocking LLM + HTTP calls: keep them off the event loop.
            await asyncio.to_thread(generate_report, domain, qa_pairs, True)
        except Exception as exc:
            print(f"Partial report generation failed: {exc}")

    ctx.add_shutdown_callback(generate_partial_report_on_early_exit)

    # Hard cap so a forgotten tab can't run up STT/TTS/LLM cost: close the room
    # (the candidate is disconnected; the shutdown callback above then grades
    # whatever was answered).
    loop = asyncio.get_running_loop()
    loop.call_later(max_minutes * 60, lambda: asyncio.ensure_future(_end_interview(ctx)))

    await session.start(
        room=ctx.room,
        agent=InterviewAgent(),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    # Start the interview workflow - the graph will drive the conversation
    print("Starting changing your learning graph")
    # Trigger the agent's first turn - without this, the graph never runs
    # because it only reacts to incoming messages, and there isn't one yet.
    await session.generate_reply()

if __name__ == "__main__":
    # Default initialize_process_timeout (10s) was getting hit on this machine
    # under load - the inference subprocess (turn detector model, etc.) needs
    # a bit more than 10s to import/start, which crashed the whole worker.
    # agent_name enables explicit dispatch: the worker only joins rooms whose
    # access token (minted by the Mirracle backend) names this agent.
    agents.cli.run_app(agents.WorkerOptions(
        entrypoint_fnc=entrypoint,
        agent_name=os.getenv("AI_INTERVIEW_AGENT_NAME", "mirracle-interviewer"),
        initialize_process_timeout=30.0,
    ))
