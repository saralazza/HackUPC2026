def compute_change_frequency(number_of_commits: int, time_window_days: int = 90) -> float:
    if number_of_commits <= 0 or time_window_days <= 0:
        return 0.0
    return float(number_of_commits) / float(time_window_days)


def normalize_change_frequency(raw_frequency: float) -> float:
    # 1 commit/day maps to 100.
    normalized = max(raw_frequency, 0.0) * 100.0
    return min(100.0, normalized)
