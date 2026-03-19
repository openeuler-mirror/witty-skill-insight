You are generating an Agent Skill for AI-powered SRE diagnosis, 
based on an abstract failure pattern induced from multiple cases.

## WHAT IS A SKILL?

A skill is a folder of instructions that an AI agent loads dynamically 
to perform better at specific tasks. The skill format follows the 
Agent Skills open standard (agentskills.io).

Key properties:
- The CONSUMER of this skill is an AI AGENT, not a human engineer.
  Write instructions that an LLM can follow precisely.
- Skills use PROGRESSIVE DISCLOSURE:
  1. Agent sees only `name` + `description` (~100 tokens) to decide activation
  2. If activated, agent loads full SKILL.md body (< 500 lines, < 5000 tokens recommended)
  3. Agent loads referenced files (scripts/, references/) only when needed
- The `description` field is the TRIGGER — it determines when the agent activates this skill.
  It must be specific, keyword-rich, and slightly "pushy" (overindex on when to use it).

## SKILL STRUCTURE

Generate a skill folder with these files:

### SKILL.md (required, < 500 lines)
Contains YAML frontmatter + concise operational instructions.
This is what the agent reads when activated. It should be:
- ACTION-ORIENTED: "Do X, then check Y" not "X is a thing that..."
- DECISION-TREE STRUCTURED: Clear branching logic the agent can follow
- PARAMETERIZED: Use {{PLACEHOLDERS}} for environment-specific values
- CONCISE: Move detailed reference material to references/

### references/pattern-detail.md (optional)
Contains the detailed failure pattern information:
- Full indicator semantics and severity grading tables
- Complete known instance details and parameter comparison
- Variation vectors and differential diagnosis deep-dives
The agent reads this only when it needs deeper context.

## TRANSFORMATION RULES

Transform the failure pattern into a skill as follows:

pattern.fault_mechanism → SKILL.md: brief "Understanding" section (3-5 lines)
pattern.symptoms → SKILL.md: "Recognition" checklist for quick matching
pattern.severity_grading → SKILL.md: "Triage" quick-reference 
pattern.diagnosis_methodology → SKILL.md: "Investigation" decision tree
pattern.differential_diagnosis → SKILL.md: "Rule Out" branch in the decision tree
pattern.remediation_strategy → SKILL.md: "Resolution" action steps
pattern.known_instances → references/pattern-detail.md
pattern.variation_vectors → references/pattern-detail.md
pattern.indicator_semantics → references/pattern-detail.md (summary in SKILL.md)

## WRITING STYLE FOR AGENT CONSUMPTION

DO:
- Use imperative instructions: "Check X", "If Y then do Z", "Report finding to user"
- Use structured formats the agent can parse: numbered steps, clear conditionals
- Include exact command templates the agent can execute
- Tell the agent what to COMMUNICATE to the user at each step
- Tell the agent what TOOLS to use (bash, file read, etc.)

DON'T:
- Write explanatory prose an agent doesn't need to "understand"
- Use vague instructions like "consider checking" — be precise
- Include background knowledge the agent already has (e.g., what Linux is)
- Write more than 500 lines in SKILL.md — split to references/

## DESCRIPTION FIELD GUIDELINES

The description is the ONLY thing the agent sees before activation.
It must contain:
- What the skill does (diagnose + remediate a class of failures)
- Specific keywords/error messages that should trigger activation
- Explicit "use this skill when..." guidance

Make it slightly pushy — the agent tends to under-trigger skills.
Include the most common error strings from known instances as trigger keywords.
Max 1024 characters.


Generate a diagnostic Agent Skill from the following failure pattern.

## Failure Pattern:
{pattern_json}

## Output Requirements:

1. Generate SKILL.md with proper YAML frontmatter:
   - name: kebab-case, max 64 chars, descriptive
   - description: max 1024 chars, keyword-rich, trigger-optimized
   - Body: < 500 lines, structured as decision tree

2. Generate references/pattern-detail.md with:
   - Full severity grading framework with thresholds
   - Full indicator semantics and relationships
   - Known instance comparison table
   - Variation vectors and differential diagnosis details

3. SKILL.md structure should follow this order:
   a) Understanding: 3-5 line mechanism summary
   b) Recognition: symptom checklist with confidence scoring
   c) Triage: severity quick-check (agent determines urgency in < 2 minutes)
   d) Investigation: hypothesis-driven decision tree with commands
   e) Rule Out: differential diagnosis branch
   f) Resolution: action steps by urgency level
   g) Verification: how to confirm the fix worked

4. The skill must be SELF-ACTIVATING: the description field alone 
   should cause the agent to pick up this skill when a user describes 
   symptoms matching this pattern.

5. The skill must be EXECUTABLE: every diagnostic and remediation step 
   should include a command template the agent can run.

6. Mark steps from [domain_knowledge] in the pattern clearly, 
   so the agent can communicate confidence levels to the user.

Output the SKILL.md content first, then references/pattern-detail.md.