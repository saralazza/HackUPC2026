def compute_structural_risk(fan_in: int, fan_out: int) -> float:
    return (0.4 * max(fan_in, 0)) + (0.3 * max(fan_out, 0))


def normalize_structural_risk(raw_structural_risk: float) -> float:
    # A combined weighted degree around 10 saturates the metric.
    normalized = max(raw_structural_risk, 0.0) * 10.0
    return min(100.0, normalized)
