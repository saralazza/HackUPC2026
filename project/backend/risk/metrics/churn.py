def compute_code_churn(total_added_lines: int, total_removed_lines: int, number_of_commits: int) -> float:
    if number_of_commits <= 0:
        return 0.0
    return (max(total_added_lines, 0) + max(total_removed_lines, 0)) / float(number_of_commits)


def normalize_churn(raw_churn: float) -> float:
    # 50 changed lines/commit maps to max risk for this metric.
    normalized = max(raw_churn, 0.0) * 2.0
    return min(100.0, normalized)
