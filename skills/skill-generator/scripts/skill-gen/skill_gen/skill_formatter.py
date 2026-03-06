from typing import List, Optional
import textwrap
from .schema import Skill, FailurePattern, RemediationType, CommandType

class SkillFormatter:
    def render(self, skill: Skill, generated_scripts: Optional[List[dict]] = None, reference_files: Optional[List[str]] = None) -> str:
        """
        Render a Skill object into a Markdown string following the SKILL.md structure.
        
        Args:
            skill: The Skill object to render
            generated_scripts: List of script info dicts (from asset extraction)
            reference_files: List of reference file paths (from asset extraction)
        """
        pattern = skill.failure_pattern
        
        sections = []
        
        # 1. YAML Frontmatter
        sections.append(self._render_frontmatter(pattern, skill))
        
        # 2. Title & Overview
        sections.append(self._render_title_and_overview(skill))
        
        # 3. When to Use
        sections.append(self._render_when_to_use(pattern))
        
        # 4. Diagnosis Steps
        sections.append(self._render_diagnosis_steps(pattern))
        
        # 5. Remediation Steps
        sections.append(self._render_remediation_steps(pattern))
        
        # 6. Verification
        if pattern.verification:
            sections.append(self._render_verification(pattern))
            
        # 7. Knowledge Gaps
        if pattern.knowledge_gaps:
            sections.append(self._render_knowledge_gaps(pattern))
            
        # 8. Source References & Scripts
        sections.append(self._render_references(skill, generated_scripts, reference_files))
        
        return "\n\n".join(sections)

    def _render_frontmatter(self, pattern: FailurePattern, skill: Skill = None) -> str:
        # Use the summary from the pattern which should now be high-level and include trigger conditions
        description = getattr(pattern, 'summary', "")
        
        # Fallback if summary is empty (e.g. legacy pattern)
        if not description:
             description = f"该故障模式涉及 {pattern.pattern_name}。主要现象包括：{', '.join(pattern.symptoms.primary)}。"
             if skill and skill.failure_cases:
                 root_cause = skill.failure_cases[0].root_cause
                 if len(root_cause) < 50:
                      description = f"{root_cause} 故障表现为：{', '.join(pattern.symptoms.primary)}"
                 else:
                      description = root_cause

        # Construct keywords from pattern content
        keywords = []
        # Add pattern name parts
        keywords.extend(pattern.pattern_name.split())
        # Add category
        if pattern.category:
            keywords.append(pattern.category.value)
        # Add hardware/platform info
        if pattern.applicable_scope:
            if pattern.applicable_scope.hardware:
                keywords.append(pattern.applicable_scope.hardware)
            if pattern.applicable_scope.platform:
                keywords.append(pattern.applicable_scope.platform)
        
        # Add symptoms keywords (simple split)
        if pattern.symptoms and pattern.symptoms.primary:
            for s in pattern.symptoms.primary:
                import re
                words = re.findall(r'\w+', s)
                keywords.extend([w for w in words if len(w) > 2])
            
        # Deduplicate and clean keywords
        keywords = sorted(list(set([k for k in keywords if k and len(k) > 1])))
        # Limit keywords count
        keywords = keywords[:10]

        import json
        
        # Clean description for YAML (remove newlines if necessary or use block scalar style)
        # Using > block scalar style is good for long text.
        
        return textwrap.dedent(f"""
            ---
            name: {pattern.pattern_name}
            description: >
              {description}
            metadata:
              keywords: {json.dumps(keywords, ensure_ascii=False)}
            ---
        """).strip()

    def _render_title_and_overview(self, skill: Skill) -> str:
        pattern = skill.failure_pattern
        # Use summary for overview
        overview = getattr(pattern, 'summary', "")
        
        if not overview:
            if skill.failure_cases and skill.failure_cases[0].root_cause:
                overview = skill.failure_cases[0].root_cause
            else:
                overview = f"该故障模式涉及 {pattern.pattern_name}。"

        return textwrap.dedent(f"""
            # {pattern.pattern_name}

            ## 概述
            {overview}
        """).strip()

    def _render_when_to_use(self, pattern: FailurePattern) -> str:
        lines = ["## 适用场景 (When to Use)"]
        
        lines.append("\n### 触发条件")
        for tc in pattern.trigger_conditions:
            lines.append(f"- {tc.condition}")
        if pattern.trigger_condition_note:
            lines.append(f"\n> 注意: {pattern.trigger_condition_note}")
            
        lines.append("\n### 故障现象")
        if pattern.symptoms.primary:
            for s in pattern.symptoms.primary:
                lines.append(f"- {s}")
        
        if pattern.symptoms.characteristic_errors:
            lines.append("\n**特征报错**:")
            for err in pattern.symptoms.characteristic_errors:
                lines.append(f"- `{err}`")
                
        return "\n".join(lines)

    def _render_diagnosis_steps(self, pattern: FailurePattern) -> str:
        lines = ["## 诊断步骤 (Diagnosis Steps)"]
        
        sorted_steps = sorted(pattern.diagnosis_steps, key=lambda x: x.step)
        
        for step in sorted_steps:
            lines.append(f"\n### 步骤 {step.step}: {step.action}")
            lines.append(f"- **位置**: {step.where}")
            lines.append(f"- **期望输出**: {step.expected_output}")
            if step.critical:
                lines.append(f"- **关键步骤**: 是")
            
            if step.command:
                lines.append("\n```bash")
                lines.append(step.command)
                lines.append("```")
                
        if pattern.diagnosis_decision:
            lines.append(f"\n> **判定标准**: {pattern.diagnosis_decision}")
            
        return "\n".join(lines)

    def _render_remediation_steps(self, pattern: FailurePattern) -> str:
        lines = ["## 处置步骤 (Remediation Steps)"]
        
        workarounds = [s for s in pattern.remediation_steps if s.type == RemediationType.WORKAROUND]
        root_fixes = [s for s in pattern.remediation_steps if s.type in (RemediationType.ROOT_FIX, RemediationType.ROOT_FIX_ALTERNATIVE)]
        
        # Render Workarounds first
        if workarounds:
            lines.append("\n### 临时规避 (Workaround)")
            for step in sorted(workarounds, key=lambda x: x.step):
                self._format_remediation_step(lines, step)
                if step.workaround_warning:
                    lines.append(f"> ⚠️ **警告**: {step.workaround_warning}")

        # Render Root Fixes
        if root_fixes:
            lines.append("\n### 根因修复 (Root Fix)")
            for step in sorted(root_fixes, key=lambda x: x.step):
                self._format_remediation_step(lines, step)

        return "\n".join(lines)

    def _format_remediation_step(self, lines: List[str], step):
        lines.append(f"\n#### 步骤 {step.step}: {step.action}")
        if step.prerequisite:
            lines.append(f"- **前置条件**: {step.prerequisite}")
        if step.condition:
            lines.append(f"- **适用条件**: {step.condition}")
        
        if step.command:
            lines.append("\n```bash")
            lines.append(step.command)
            lines.append("```")
            
        if step.warning:
            lines.append(f"\n> ⚠️ {step.warning}")
        
        if step.rollback:
            lines.append(f"\n> **回滚方案**: {step.rollback}")

    def _render_verification(self, pattern: FailurePattern) -> str:
        lines = ["## 验证 (Verification)"]
        for v in pattern.verification:
            lines.append(f"\n- **动作**: {v.action}")
            lines.append(f"- **期望结果**: {v.expected}")
        return "\n".join(lines)

    def _render_knowledge_gaps(self, pattern: FailurePattern) -> str:
        lines = ["## 知识缺口 (Knowledge Gaps)"]
        for gap in pattern.knowledge_gaps:
            blocking_str = "🔴 [BLOCKING]" if gap.blocking else "🟡"
            lines.append(f"- {blocking_str} **{gap.id}** ({gap.type.value}): {gap.description}")
            if gap.location:
                lines.append(f"  - 位置: {gap.location}")
        return "\n".join(lines)

    def _render_references(self, skill: Skill, generated_scripts: Optional[List[dict]] = None, reference_files: Optional[List[str]] = None) -> str:
        lines = ["## 参考资料 (References)"]
        
        if skill.general_experiences:
            lines.append("\n### 通用经验 (General Experience)")
            for exp in skill.general_experiences:
                # Handle multiline content for blockquote
                content_lines = exp.content.splitlines()
                quoted_content = "\n".join([f"> {line}" for line in content_lines])
                lines.append(f"\n{quoted_content}")
                if exp.source:
                    lines.append(f"> \n> Source: {exp.source}")

        # Add generated reference files if available
        if reference_files:
            lines.append("\n### 参考文件说明")
            for ref_file in reference_files:
                # Assuming ref_file is a relative path like 'references/content.md'
                lines.append(f"- `{ref_file}`")
        
        # Add generated scripts if available
        if generated_scripts:
            if not reference_files: # Add header if not already added
                 lines.append("\n### 参考文件说明")
            for script in generated_scripts:
                 filename = script.get('filename', 'unknown')
                 rel_path = script.get('relative_path', f"scripts/{filename}")
                 lines.append(f"- `{rel_path}`")

        # List source documents from failure cases
        docs = set()
        for case in skill.failure_cases:
            if case.source_documents:
                for doc in case.source_documents:
                    docs.add(doc)
        
        if docs:
            lines.append("\n### 来源文档")
            for doc in sorted(docs):
                lines.append(f"- {doc}")
                
        # List related cases
        if skill.failure_pattern.source_cases:
            lines.append("\n### 关联案例")
            for case_id in skill.failure_pattern.source_cases:
                lines.append(f"- {case_id}")
        
        # Add Scripts Section if available
        if generated_scripts:
            lines.append("\n## 脚本工具使用说明 (Executable Scripts)")
            for script in generated_scripts:
                filename = script.get('filename', 'unknown')
                rel_path = script.get('relative_path', f"scripts/{filename}")
                lang = script.get('language', 'bash')
                lines.append(f"- **脚本路径**: `{rel_path}`")
                lines.append(f"- **语言**: {lang}")
                lines.append(f"- **功能**: 自动提取自文档，请参考脚本注释或源码了解详细功能。")
                lines.append("")

        return "\n".join(lines)
