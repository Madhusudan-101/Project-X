"""Default Online Assessment templates.

Used to provision `oa_assessments` / `oa_sections` / `oa_questions` the first
time a candidate opens the OA for a drive that has none yet. Three formats:

  coding     — three single-question coding sections (15 / 30 / 45 min)
  analytics  — SQL + quant + data-interpretation + aptitude (HackerRank-style)
  aptitude   — the analytics format without the SQL section

MCQ answer keys live ONLY in this module and the `oa_questions` table; the
candidate API never serialises `correct_option`.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

_STUB = {
    "python": "def solve():\n    # write your solution here\n    pass\n",
    "javascript": "function solve() {\n  // write your solution here\n}\n",
    "java": "class Solution {\n    // write your solution here\n}\n",
    "cpp": "#include <bits/stdc++.h>\nusing namespace std;\n\n// write your solution here\n",
}


def _coding(title: str, prompt: str, points: int = 100, library_problem: str | None = None) -> Dict[str, Any]:
    """`library_problem`: id of a validated oa_problems row that replaces this stored-only
    question when the library is loaded (see provision_template). Never written to the DB."""
    return {
        "library_problem": library_problem,
        "qtype": "coding",
        "title": title,
        "prompt": prompt,
        "starter_code": dict(_STUB),
        "points": points,
    }


def _sql(title: str, prompt: str, points: int = 50) -> Dict[str, Any]:
    return {
        "qtype": "coding",
        "title": title,
        "prompt": prompt,
        "starter_code": {"sql": "-- write your query here\n"},
        "points": points,
    }


def _mcq(title: str, prompt: str, options: List[str], correct: int) -> Dict[str, Any]:
    return {
        "qtype": "mcq",
        "title": title,
        "prompt": prompt,
        "options": options,
        "correct_option": correct,
        "points": 10,
    }


_CODING_SECTIONS: List[Dict[str, Any]] = [
    {
        "title": "Coding 1",
        "kind": "coding",
        "duration_minutes": 15,
        "questions": [
            _coding(
                "Two Sum",
                "Given an array of integers `nums` and an integer `target`, return the indices "
                "`[i, j]` (i < j) of the two numbers that add up to `target`.\n\n"
                "Exactly one valid pair exists. You may not use the same element twice.\n\n"
                "**Input**\n- `nums`: list of n integers, 2 <= n <= 10^5\n- `target`: integer\n\n"
                "**Output**\n- A pair of indices.\n\n"
                "**Example**\n`nums = [2, 7, 11, 15], target = 9` → `[0, 1]`\n\n"
                "Aim for O(n) time.",
                library_problem="two-sum",
            )
        ],
    },
    {
        "title": "Coding 2",
        "kind": "coding",
        "duration_minutes": 30,
        "questions": [
            _coding(
                "Merge Intervals",
                "Given a list of intervals `[start, end]`, merge all overlapping intervals and "
                "return the result sorted by start.\n\n"
                "Intervals that touch (e.g. `[1, 3]` and `[3, 5]`) count as overlapping.\n\n"
                "**Example**\n`[[1,3],[2,6],[8,10],[15,18]]` → `[[1,6],[8,10],[15,18]]`\n\n"
                "**Constraints**\n- 1 <= intervals.length <= 10^5\n- 0 <= start <= end <= 10^9",
                library_problem="merge-intervals",
            )
        ],
    },
    {
        "title": "Coding 3",
        "kind": "coding",
        "duration_minutes": 45,
        "questions": [
            _coding(
                "Course Schedule",
                "There are `n` courses labelled `0 .. n-1`. You are given prerequisite pairs "
                "`[a, b]` meaning you must take course `b` before course `a`.\n\n"
                "Return `true` if it is possible to finish all courses, otherwise `false`. "
                "If it is possible, also return one valid order in which to take them.\n\n"
                "**Example**\n`n = 4, prerequisites = [[1,0],[2,1],[3,2]]` → `true, [0,1,2,3]`\n\n"
                "`n = 2, prerequisites = [[1,0],[0,1]]` → `false`\n\n"
                "**Constraints**\n- 1 <= n <= 10^5\n- 0 <= prerequisites.length <= 2 * 10^5",
                library_problem="course-schedule",
            )
        ],
    },
]

_SQL_SECTION: Dict[str, Any] = {
    "title": "SQL (Intermediate)",
    "kind": "sql",
    "duration_minutes": 25,
    "questions": [
        _sql(
            "Departments above average pay",
            "Tables:\n\n`employees(id, name, department_id, salary)`\n"
            "`departments(id, name)`\n\n"
            "Return each department name together with its average salary (`avg_salary`), "
            "only for departments whose average salary is greater than 60000. "
            "Order by `avg_salary` descending.",
        ),
        _sql(
            "Second highest salary per department",
            "Using the same tables, return `department`, `name` and `salary` for every employee "
            "who earns the **second highest distinct salary** in their department. "
            "Departments with fewer than two distinct salaries return no row. "
            "Order by department, then name.",
        ),
    ],
}

_APTITUDE_SECTIONS: List[Dict[str, Any]] = [
    {
        "title": "Quant",
        "kind": "mcq",
        "duration_minutes": 15,
        "questions": [
            _mcq("Speed", "A train 150 m long passes a pole in 15 seconds. What is its speed in km/h?",
                 ["30", "36", "40", "54"], 1),
            _mcq("Successive change", "A price is increased by 20% and then decreased by 20%. "
                 "What is the net change?",
                 ["No change", "4% decrease", "4% increase", "2% decrease"], 1),
            _mcq("Work", "A can finish a job in 12 days and B in 18 days. Working together, "
                 "how many days do they need?",
                 ["6", "7.2", "8", "7.5"], 1),
        ],
    },
    {
        "title": "Data Interpretation I",
        "kind": "mcq",
        "duration_minutes": 10,
        "questions": [
            _mcq(
                "Annual sales of A",
                "Quarterly sales (₹ lakh):\n\n| Quarter | Product A | Product B |\n|---|---|---|\n"
                "| Q1 | 40 | 55 |\n| Q2 | 50 | 45 |\n| Q3 | 60 | 65 |\n| Q4 | 30 | 35 |\n\n"
                "What are Product A's total sales for the year?",
                ["170", "180", "190", "200"], 1),
            _mcq(
                "Best quarter",
                "Using the same table (Q1: 40/55, Q2: 50/45, Q3: 60/65, Q4: 30/35), "
                "in which quarter were combined sales of A and B highest?",
                ["Q1", "Q2", "Q3", "Q4"], 2),
            _mcq(
                "Percent more",
                "Using the same table, Product B's Q3 sales are what percent more than its Q4 sales?",
                ["75%", "80%", "About 85.7%", "90%"], 2),
        ],
    },
    {
        "title": "Data Interpretation II",
        "kind": "mcq",
        "duration_minutes": 10,
        "questions": [
            _mcq(
                "Food spend",
                "A monthly budget of ₹60,000 is split: Rent 30%, Food 25%, Transport 10%, "
                "Savings 20%, Misc 15%. How much is spent on Food?",
                ["₹12,000", "₹15,000", "₹18,000", "₹20,000"], 1),
            _mcq(
                "Savings vs transport",
                "Same budget (₹60,000; Rent 30%, Food 25%, Transport 10%, Savings 20%, Misc 15%). "
                "By how much do Savings exceed Transport?",
                ["₹3,000", "₹6,000", "₹9,000", "₹12,000"], 1),
            _mcq(
                "Rent hike",
                "Same budget. If Rent rises by 10% of its value and nothing else changes, "
                "what is the new total?",
                ["₹61,800", "₹63,000", "₹66,000", "₹60,000"], 0),
        ],
    },
    {
        "title": "Aptitude I",
        "kind": "mcq",
        "duration_minutes": 10,
        "questions": [
            _mcq("Series", "What comes next: 2, 6, 12, 20, 30, ?", ["40", "42", "44", "48"], 1),
            _mcq("Letter code", "If CAT is coded as 24 (C=3, A=1, T=20 → 3+1+20), what is DOG?",
                 ["24", "26", "28", "30"], 1),
            _mcq(
                "Syllogism",
                "All roses are flowers. Some flowers fade quickly. Which conclusion follows "
                "definitely?",
                ["All roses fade quickly", "Some roses fade quickly",
                 "No rose fades quickly", "None of these follows definitely"], 3),
        ],
    },
    {
        "title": "Aptitude II",
        "kind": "mcq",
        "duration_minutes": 10,
        "questions": [
            _mcq("Blood relation",
                 "Pointing to a man, Riya says, \"He is the son of my mother's only brother.\" "
                 "How is the man related to Riya?",
                 ["Brother", "Cousin", "Uncle", "Nephew"], 1),
            _mcq("Probability", "Two fair dice are rolled. What is the probability that the sum is 8?",
                 ["1/6", "5/36", "1/9", "7/36"], 1),
            _mcq("Average", "The average of 5 numbers is 20. When one number is removed the average "
                 "of the rest is 18. Which number was removed?",
                 ["26", "28", "30", "32"], 1),
        ],
    },
]

_DATA_TITLE_RE = re.compile(r"\b(data|analyst|analytics|sql|bi|business intelligence)\b", re.I)


def pick_template(job: Dict[str, Any]) -> str:
    if job.get("domain") == "non-tech":
        return "aptitude"
    if _DATA_TITLE_RE.search(job.get("title") or ""):
        return "analytics"
    return "coding"


def template_sections(template: str) -> List[Dict[str, Any]]:
    if template == "coding":
        return _CODING_SECTIONS
    if template == "analytics":
        return [_SQL_SECTION, *_APTITUDE_SECTIONS]
    return _APTITUDE_SECTIONS
