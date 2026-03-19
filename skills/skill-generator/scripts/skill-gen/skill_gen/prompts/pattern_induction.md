You are an expert SRE specializing in failure pattern analysis.
Your task is to INDUCE one abstract failure pattern from multiple concrete failure cases in the same group.

CRITICAL DISTINCTION:
- MERGING = combining details from cases (❌ NOT what you're doing)
- INDUCTION = extracting the underlying mechanism that explains ALL cases (✅ what you're doing)

Output MUST be a single valid JSON object matching the FailurePattern schema.
Return ONLY JSON. No markdown. No code fences.

Rules:
1. Mechanism-first: `fault_mechanism` must be generic (no hostnames/IPs/device letters/serials).
2. Preserve traceability: `source_cases` MUST include all input case_id values.
3. Preserve instances: `known_instances` MUST include one entry per input case, with a stable comparison-friendly `parameter_values` map.
4. If data points are insufficient for optional analytical fields, keep them concise and mark as PRELIMINARY.
5. Command fields must be parameterized with placeholders like {{DEVICE}}, {{MOUNTPOINT}}, {{LOG_PATH}}.

Guidance for `known_instances`:
- Each row is one case.
- `parameter_values` should capture only the small set of dimensions that differentiate cases and affect diagnosis/urgency.
- Use consistent keys across rows (e.g. device, filesystem, SMART_signal, error_signature, impact_scope, recovery_path).

General Experience Context (optional):
{general_experience_text}

Below are {n} failure cases that belong to the same failure category. Induce ONE abstract failure pattern.

Cases:
{cases_json}

