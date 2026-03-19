#!/usr/bin/env python3
"""
Markdown Documentation to Claude Skill Converter

Converts Markdown documentation into Claude AI skills.
Parses markdown content, extracts code samples, headings, and builds skill structure.

Usage:
    python3 md_scraper.py --config configs/manual_md.json
    python3 md_scraper.py --md manual.md --name myskill
    python3 md_scraper.py --from-json manual_extracted.json
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional

from ..skill_name_gen import normalize_skill_name

# Import language detector for code analysis
try:
    from .language_detector import LanguageDetector
except ImportError:
    LanguageDetector = None


def infer_description_from_markdown(content: str = None, name: str = "") -> str:
    """
    Infer skill description from markdown content.

    Tries to extract meaningful description from:
    1. First heading (h1)
    2. First paragraph
    3. Falls back to improved template

    Args:
        content: Markdown content string
        name: Skill name for fallback

    Returns:
        Description string suitable for "Use when..." format
    """
    if content:
        # Try to extract first h1 heading
        h1_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if h1_match:
            title = h1_match.group(1).strip()
            if len(title) > 10 and len(title) < 100:
                return f"Use when working with {title.lower()}"

        # Try to extract first meaningful paragraph
        paragraphs = content.split("\n\n")
        for para in paragraphs:
            para = para.strip()
            # Skip headings, code blocks, lists
            if (
                para
                and not para.startswith("#")
                and not para.startswith("```")
                and not para.startswith("-")
                and not para.startswith("*")
            ):
                if len(para) > 30 and len(para) < 200:
                    # Clean markdown formatting
                    para = re.sub(r"[#*_`\[\]()]", "", para)
                    para = para.strip()
                    if len(para) > 30:
                        if len(para) > 150:
                            para = para[:147] + "..."
                        return f"Use when {para.lower()}"

    # Improved fallback
    return (
        f"Use when referencing {name} documentation"
        if name
        else "Use when referencing this documentation"
    )


class MarkdownParser:
    """Parse markdown content into structured page data"""

    def __init__(self, content: str, language_detector=None):
        self.content = content
        self.language_detector = language_detector

    def parse(self) -> Dict[str, Any]:
        """
        Parse markdown content into page structure.

        Returns:
            Dict with pages, total_pages, code_samples, headings, etc.
        """
        pages = []

        # For markdown files, we should treat the entire document as one page
        # unless there are multiple top-level H1 sections (which is rare)
        # This is different from PDF which naturally has pages, and different from
        # llms.txt which may have multiple top-level sections

        # Count actual H1 headers (not in code blocks)
        # First, remove code blocks temporarily to count H1 headers
        content_without_code = re.sub(r"```.*?```", "", self.content, flags=re.DOTALL)
        h1_count = len(re.findall(r"^#\s+", content_without_code, flags=re.MULTILINE))

        # If only one H1 or no H1, treat entire content as one page
        if h1_count <= 1:
            # Single page - use first H1 as title, or "Content" if no H1
            title_match = re.search(r"^#\s+(.+)$", self.content, re.MULTILINE)
            if title_match:
                title = title_match.group(1).strip()
                # Remove title from content for parsing
                content_for_parsing = re.sub(
                    r"^#\s+.+$", "", self.content, count=1, flags=re.MULTILINE
                ).strip()
            else:
                title = "Content"
                content_for_parsing = self.content

            page = self._parse_section(content_for_parsing, title, 1)
            pages.append(page)
        else:
            # Multiple H1 sections - split by H1 headers
            # Only split at start of line (^) to avoid matching # in code blocks
            sections = re.split(r"^(?=#\s)", self.content, flags=re.MULTILINE)

            for section_idx, section in enumerate(sections):
                if not section.strip():
                    continue

                # Extract title (first h1 or use default)
                title_match = re.search(r"^#\s+(.+)$", section, re.MULTILINE)
                if title_match:
                    title = title_match.group(1).strip()
                    # Remove title from content
                    section = re.sub(
                        r"^#\s+.+$", "", section, count=1, flags=re.MULTILINE
                    ).strip()
                else:
                    title = f"Section {section_idx + 1}"

                # Parse section into page structure
                page = self._parse_section(section, title, section_idx + 1)
                pages.append(page)

        # Calculate statistics
        all_code_samples = []
        all_headings = []
        languages_detected = {}

        for page in pages:
            all_code_samples.extend(page.get("code_samples", []))
            all_headings.extend(page.get("headings", []))

            # Count languages
            for code in page.get("code_samples", []):
                lang = code.get("language", "unknown")
                languages_detected[lang] = languages_detected.get(lang, 0) + 1

        # Calculate quality statistics for code samples
        quality_stats = self._calculate_quality_stats(all_code_samples)

        return {
            "pages": pages,
            "total_pages": len(pages),
            "total_code_blocks": len(all_code_samples),
            "total_headings": len(all_headings),
            "languages_detected": languages_detected,
            "quality_statistics": quality_stats,
        }

    def _parse_section(self, content: str, title: str, page_number: int) -> Dict:
        """Parse a single section into page structure"""
        page = {
            "page_number": page_number,
            "title": title,
            "text": "",
            "headings": [],
            "code_samples": [],
            "code_blocks": [],  # Alias for compatibility
            "images": [],
        }

        # Extract code blocks (```language\ncode\n```)
        # Use a robust pattern that handles code blocks with optional language tags
        # Match code blocks more carefully to avoid false positives
        code_pattern = r"```(\w+)?\s*\n(.*?)```"
        code_matches = list(re.finditer(code_pattern, content, re.DOTALL))

        for match in code_matches:
            lang = match.group(1) or "unknown"
            code = match.group(2).strip()

            # Skip empty or very short code blocks
            if len(code) <= 10:
                continue

            # Skip if it's actually just markdown headers/text (common false positive)
            if code.strip().startswith("#") and not code.strip().startswith("#!"):
                # Check if it looks like code (has import, def, class, etc.) or just headers
                if not any(
                    keyword in code
                    for keyword in [
                        "import ",
                        "def ",
                        "class ",
                        "from ",
                        "if __name__",
                        "function",
                        "const ",
                        "let ",
                        "var ",
                        "print(",
                        "return ",
                        "try:",
                        "except",
                        "for ",
                        "while ",
                        "if ",
                    ]
                ):
                    continue

            # Detect language if not specified or if language_detector available
            if lang == "unknown" and self.language_detector:
                detected_lang, confidence = self.language_detector.detect_from_code(
                    code
                )
                if confidence > 0.3:
                    lang = detected_lang

            # Calculate quality score
            quality_score = self._calculate_code_quality(code, lang)

            code_block = {
                "code": code,
                "language": lang,
                "quality_score": quality_score,
            }

            page["code_samples"].append(code_block)
            page["code_blocks"].append(code_block)  # Alias

        # Extract headings (h2-h6)
        heading_pattern = r"^(#{2,6})\s+(.+)$"
        for match in re.finditer(heading_pattern, content, re.MULTILINE):
            level_markers = match.group(1)
            text = match.group(2).strip()

            level = len(level_markers)
            page["headings"].append(
                {"level": f"h{level}", "text": text, "id": self._slugify(text)}
            )

        # Extract images
        image_pattern = r"!\[([^\]]*)\]\(([^)]+)\)"
        for match in re.finditer(image_pattern, content):
            alt_text = match.group(1)
            img_path = match.group(2)
            page["images"].append(
                {"alt": alt_text, "path": img_path, "index": len(page["images"])}
            )

        # Extract text content (remove code blocks, images, and headings)
        text_content = content
        # Remove code blocks that were already extracted
        for code_block in page["code_samples"]:
            # Try to remove the code block from text content
            code_text = code_block["code"]
            # Escape special regex characters
            escaped_code = re.escape(code_text)
            text_content = re.sub(escaped_code, "", text_content, flags=re.DOTALL)

        # Also remove any remaining code blocks using pattern
        text_content = re.sub(r"```.*?```", "", text_content, flags=re.DOTALL)
        # Remove images
        text_content = re.sub(r"!\[([^\]]*)\]\([^)]+\)", "", text_content)
        # Remove headings
        text_content = re.sub(r"^#{1,6}\s+.+$", "", text_content, flags=re.MULTILINE)
        # Clean up whitespace
        text_content = re.sub(r"\n{3,}", "\n\n", text_content)
        text_content = text_content.strip()

        page["text"] = text_content

        return page

    def _slugify(self, text: str) -> str:
        """Convert text to URL-friendly slug"""
        text = text.lower()
        text = re.sub(r"[^\w\s-]", "", text)
        text = re.sub(r"[-\s]+", "-", text)
        return text

    def _calculate_code_quality(self, code: str, language: str) -> float:
        """
        Calculate quality score for code block (0-10).

        Factors:
        - Code length (longer is generally better)
        - Syntax completeness (basic checks)
        - Language-specific patterns
        """
        score = 0.0

        # Length factor (0-4 points)
        lines = code.split("\n")
        line_count = len([l for l in lines if l.strip()])

        if line_count >= 30:
            score += 4.0
        elif line_count >= 20:
            score += 3.0
        elif line_count >= 10:
            score += 2.0
        elif line_count >= 5:
            score += 1.0

        # Syntax completeness (0-3 points)
        # Check for balanced brackets, quotes, etc.
        if code.count("(") == code.count(")") and code.count("{") == code.count("}"):
            score += 1.5

        # Check for common patterns (0-3 points)
        if language != "unknown":
            # Language-specific patterns
            if language == "python":
                if "def " in code or "class " in code:
                    score += 2.0
                elif "import " in code:
                    score += 1.0
            elif language in ["javascript", "typescript", "js", "ts"]:
                if "function" in code or "const " in code or "let " in code:
                    score += 2.0
            elif language in ["java", "cpp", "c", "csharp"]:
                if "class " in code or "public " in code:
                    score += 2.0

        return min(score, 10.0)

    def _calculate_quality_stats(self, code_samples: List[Dict]) -> Dict:
        """Calculate quality statistics for all code samples"""
        if not code_samples:
            return {"average_quality": 0.0, "valid_code_blocks": 0, "total_blocks": 0}

        valid_blocks = [c for c in code_samples if c.get("quality_score", 0) > 0]
        avg_quality = sum(c.get("quality_score", 0) for c in code_samples) / len(
            code_samples
        )

        return {
            "average_quality": round(avg_quality, 2),
            "valid_code_blocks": len(valid_blocks),
            "total_blocks": len(code_samples),
        }


class MarkdownToSkillConverter:
    """Convert Markdown documentation to Claude skill"""

    def __init__(self, config):
        self.config = config
        self.normalize_name = bool(config.get("normalize_name", True))
        self.name = config["name"]
        self.skill_name = (
            normalize_skill_name(self.name, max_length=64, fallback_prefix="skill")
            if self.normalize_name
            else self.name
        )
        self.md_path = config.get("md_path", "")
        self.md_content = config.get("md_content", "")

        # Set initial description
        self.description = config.get(
            "description", f"Use when referencing {self.name} documentation"
        )

        # Paths
        save_dir = config.get("save_dir", "output")
        self.skill_dir = os.path.join(save_dir, self.skill_name)
        self.data_file = os.path.join(save_dir, f"{self.skill_name}_extracted.json")

        # Scripts configuration
        self.scripts_config = config.get(
            "scripts_config",
            {"line_threshold": 30, "min_quality_score": 6.0, "max_display_lines": 5},
        )

        # Categories
        self.categories = config.get("categories", {})

        # Extracted data
        self.extracted_data = None

        # Scripts tracking
        self.extracted_scripts = []

        # Language detector
        self.language_detector = None
        if LanguageDetector:
            try:
                self.language_detector = LanguageDetector(min_confidence=0.15)
            except Exception:
                pass

    def extract_markdown(self, md_path: str = None, md_content: str = None):
        """
        Extract content from markdown file or content string.

        Args:
            md_path: Path to markdown file (optional, can override config)
            md_content: Markdown content string (optional, can override config)

        Returns:
            bool: True if extraction succeeded
        """
        print(f"\n🔍 Extracting from Markdown...")

        # Use provided parameters or fall back to config
        md_path = md_path or self.md_path
        md_content = md_content or self.md_content

        # Get markdown content
        if md_content:
            content = md_content
            source_info = "provided string content"
        elif md_path:
            if not os.path.exists(md_path):
                raise FileNotFoundError(f"Markdown file not found: {md_path}")
            with open(md_path, "r", encoding="utf-8") as f:
                content = f.read()
            source_info = f"file: {md_path}"
        else:
            raise ValueError(
                "Either md_path or md_content must be provided (via config or method parameter)"
            )

        print(f"   Source: {source_info}")

        # Update description from content if not explicitly set
        if not self.config.get("description"):
            self.description = infer_description_from_markdown(content, self.name)

        # Parse markdown
        parser = MarkdownParser(content, self.language_detector)
        result = parser.parse()

        if not result or not result.get("pages"):
            print("❌ Extraction failed: No content found")
            raise RuntimeError("Failed to extract markdown content")

        # Save extracted data
        with open(self.data_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"\n💾 Saved extracted data to: {self.data_file}")
        print(f"   Pages: {result['total_pages']}")
        print(f"   Code blocks: {result['total_code_blocks']}")
        print(f"   Headings: {result['total_headings']}")

        self.extracted_data = result
        return True

    def load_extracted_data(self, json_path):
        """Load previously extracted data from JSON"""
        print(f"\n📂 Loading extracted data from: {json_path}")

        with open(json_path, "r", encoding="utf-8") as f:
            self.extracted_data = json.load(f)

        print(f"✅ Loaded {self.extracted_data['total_pages']} pages")
        return True

    def categorize_content(self):
        """Categorize pages based on chapters or keywords"""
        print(f"\n📋 Categorizing content...")

        categorized = {}

        # Use categories from config if provided
        if self.categories:
            # Check if categories is already in the right format (for tests)
            first_value = next(iter(self.categories.values()))
            if (
                isinstance(first_value, list)
                and first_value
                and isinstance(first_value[0], dict)
            ):
                # Already categorized - convert to expected format
                for cat_key, pages in self.categories.items():
                    categorized[cat_key] = {
                        "title": cat_key.replace("_", " ").title(),
                        "pages": pages,
                    }
            else:
                # Keyword-based categorization
                for cat_key, keywords in self.categories.items():
                    categorized[cat_key] = {
                        "title": cat_key.replace("_", " ").title(),
                        "pages": [],
                    }

                # Categorize by keywords
                for page in self.extracted_data["pages"]:
                    text = page.get("text", "").lower()
                    title = page.get("title", "").lower()
                    headings_text = " ".join(
                        [h["text"] for h in page.get("headings", [])]
                    ).lower()

                    # Score against each category
                    scores = {}
                    for cat_key, keywords in self.categories.items():
                        if isinstance(keywords, list):
                            score = sum(
                                1
                                for kw in keywords
                                if isinstance(kw, str)
                                and (
                                    kw.lower() in text
                                    or kw.lower() in title
                                    or kw.lower() in headings_text
                                )
                            )
                        else:
                            score = 0
                        if score > 0:
                            scores[cat_key] = score

                    # Assign to highest scoring category
                    if scores:
                        best_cat = max(scores, key=scores.get)
                        categorized[best_cat]["pages"].append(page)
                    else:
                        # Default category
                        if "other" not in categorized:
                            categorized["other"] = {"title": "Other", "pages": []}
                        categorized["other"]["pages"].append(page)
        else:
            # No categorization - use single category
            categorized["content"] = {
                "title": "Content",
                "pages": self.extracted_data["pages"],
            }

        print(f"✅ Created {len(categorized)} categories")
        for cat_key, cat_data in categorized.items():
            print(f"   - {cat_data['title']}: {len(cat_data['pages'])} pages")

        return categorized

    def build_skill(self):
        """Build complete skill structure"""
        print(f"\n🏗️  Building skill: {self.name}")

        # Create directories
        os.makedirs(f"{self.skill_dir}/references", exist_ok=True)
        os.makedirs(f"{self.skill_dir}/scripts", exist_ok=True)
        os.makedirs(f"{self.skill_dir}/assets", exist_ok=True)

        # Categorize content
        categorized = self.categorize_content()

        # Generate reference files
        print(f"\n📝 Generating reference files...")
        for cat_key, cat_data in categorized.items():
            self._generate_reference_file(cat_key, cat_data)

        # Generate scripts documentation if any scripts were extracted
        if self.extracted_scripts:
            print(f"\n📜 Generating scripts documentation...")
            self._generate_scripts_readme()
            print(
                f"   ✅ Extracted {len(self.extracted_scripts)} scripts to scripts/ directory"
            )

        # Generate SKILL.md
        self._generate_skill_md(categorized)

        print(f"\n✅ Skill built successfully: {self.skill_dir}/")
        print(f"\n📦 Next step: Package with: skill-seekers package {self.skill_dir}/")

    def _generate_reference_file(self, cat_key, cat_data):
        """Generate a reference markdown file for a category"""
        filename = f"{self.skill_dir}/references/{cat_key}.md"

        with open(filename, "w", encoding="utf-8") as f:
            f.write(f"# {cat_data['title']}\n\n")

            for page in cat_data["pages"]:
                # Add title as section marker
                f.write(f"## {page['title']}\n\n")

                # Add headings as sub-sections
                for heading in page.get("headings", []):
                    level = len(heading["level"]) - 1  # h2 -> ##, h3 -> ###
                    f.write("#" * (level + 2) + f" {heading['text']}\n\n")

                # Add text content
                if page.get("text"):
                    # Limit to first 10000 chars per page to avoid huge files
                    text = page["text"][:10000]
                    f.write(f"{text}\n\n")

                # Add code samples
                code_list = page.get("code_samples") or page.get("code_blocks")
                if code_list:
                    # First pass: identify which code blocks are extracted to scripts/
                    extracted_languages = set()
                    script_references = {}

                    for code_index, code in enumerate(code_list):
                        lang = code.get("language", "")
                        cleaned_code = self._clean_code_whitespace(code["code"])
                        line_count = len(cleaned_code.split("\n"))

                        # Check if this code block is extracted to scripts/
                        script_info = self._extract_code_to_script(
                            code, page["page_number"], code_index
                        )

                        if script_info:
                            extracted_languages.add(lang)
                            if lang not in script_references:
                                script_references[lang] = {
                                    "filename": script_info["filename"],
                                    "relative_path": script_info["relative_path"],
                                    "line_count": line_count,
                                    "quality": code.get("quality_score", 0),
                                }

                    # Second pass: generate output
                    if script_references or any(
                        lang not in extracted_languages
                        for lang in [c.get("language", "") for c in code_list]
                    ):
                        f.write("### Code Examples\n\n")

                        # Show script references for extracted languages
                        max_display_lines = self.scripts_config.get(
                            "max_display_lines", 5
                        )
                        for lang, ref_info in script_references.items():
                            line_count = ref_info["line_count"]
                            if line_count > max_display_lines:
                                display_line_info = f"{max_display_lines}+ lines"
                            else:
                                display_line_info = f"{line_count} lines"

                            f.write(
                                f"**{lang.upper()} Script** "
                                f"({display_line_info}, Quality: {ref_info['quality']:.1f}/10)\n\n"
                            )
                            f.write(
                                f"📄 **Complete script available**: [`{ref_info['filename']}`](../{ref_info['relative_path']})\n\n"
                            )

                        # Show inline code only for non-extracted languages
                        for code_index, code in enumerate(code_list):
                            lang = code.get("language", "")
                            quality = code.get("quality_score", 0)

                            # Skip if this language has been extracted to scripts/
                            if lang in extracted_languages:
                                continue

                            # Show inline code for short snippets
                            cleaned_code = self._clean_code_whitespace(code["code"])
                            line_count = len(cleaned_code.split("\n"))

                            f.write(
                                f"**{lang.upper()} Example** "
                                f"(Lines: {line_count}, Quality: {quality:.1f}/10)\n\n"
                            )
                            f.write(f"```{lang}\n{cleaned_code}\n```\n\n")

                # Add images
                if page.get("images"):
                    f.write("### Images\n\n")
                    for img in page["images"]:
                        # Note: Images are referenced but not copied (user should handle separately)
                        f.write(f"![{img['alt']}]({img['path']})\n\n")

                f.write("---\n\n")

        print(f"   Generated: {filename}")

    def _generate_skill_md(self, categorized):
        """Generate main SKILL.md file"""
        filename = f"{self.skill_dir}/SKILL.md"

        skill_name = normalize_skill_name(
            self.name, max_length=64, fallback_prefix="skill"
        )

        # Truncate description to 1024 chars if needed
        desc = (
            self.description[:1024]
            if len(self.description) > 1024
            else self.description
        )

        with open(filename, "w", encoding="utf-8") as f:
            # Write YAML frontmatter
            f.write(f"---\n")
            f.write(f"name: {skill_name}\n")
            f.write(f"description: {desc}\n")
            f.write(f"---\n\n")

            f.write(f"# {self.name.title()} Documentation Skill\n\n")
            f.write(f"{self.description}\n\n")

            f.write("## When to use this skill\n\n")
            f.write(
                f"Use this skill when the user asks about {self.name} documentation, "
            )
            f.write(
                "including API references, tutorials, examples, and best practices.\n\n"
            )

            f.write("## What's included\n\n")
            f.write("This skill contains:\n\n")
            for cat_key, cat_data in categorized.items():
                f.write(f"- **{cat_data['title']}**: {len(cat_data['pages'])} pages\n")

            # Add scripts index if any scripts were extracted
            if self.extracted_scripts:
                f.write(f"\n## Executable Scripts\n\n")
                f.write(
                    f"This skill includes **{len(self.extracted_scripts)} executable code examples** "
                )
                f.write(f"extracted from the documentation.\n\n")

                # Count by language
                scripts_by_lang = {}
                for script in self.extracted_scripts:
                    lang = script["language"]
                    scripts_by_lang[lang] = scripts_by_lang.get(lang, 0) + 1

                f.write("**Available Languages:**\n\n")
                for lang, count in sorted(
                    scripts_by_lang.items(), key=lambda x: x[1], reverse=True
                ):
                    f.write(f"- {lang.upper()}: {count} scripts\n")

                f.write("\n**Scripts Directory**: `scripts/`\n\n")
                f.write(
                    "See [`scripts/README.md`](scripts/README.md) for the complete list of available scripts.\n\n"
                )

            f.write("\n## Quick Reference\n\n")

            # Get high-quality code samples
            all_code = []
            for page in self.extracted_data["pages"]:
                all_code.extend(page.get("code_samples", []))

            # Sort by quality and get top 5
            all_code.sort(key=lambda x: x.get("quality_score", 0), reverse=True)
            top_code = all_code[:5]

            if top_code:
                f.write("### Top Code Examples\n\n")
                for i, code in enumerate(top_code, 1):
                    lang = code["language"]
                    quality = code.get("quality_score", 0)
                    f.write(f"**Example {i}** (Quality: {quality:.1f}/10):\n\n")
                    f.write(f"```{lang}\n{code['code'][:300]}...\n```\n\n")

            f.write("## Navigation\n\n")

            # Add language statistics
            langs = self.extracted_data.get("languages_detected", {})
            if langs:
                f.write("## Languages Covered\n\n")
                for lang, count in sorted(
                    langs.items(), key=lambda x: x[1], reverse=True
                ):
                    f.write(f"- {lang}: {count} examples\n")

        print(f"   Generated: {filename}")

    def _sanitize_filename(self, name):
        """Convert string to safe filename"""
        safe = re.sub(r"[^\w\s-]", "", name.lower())
        safe = re.sub(r"[-\s]+", "_", safe)
        return safe

    def _clean_code_whitespace(self, code):
        """
        Clean non-standard whitespace characters from code.
        """
        # Replace non-breaking space (U+00A0) with regular space
        code = code.replace("\xa0", " ")
        code = code.replace("\u2002", " ")  # En space
        code = code.replace("\u2003", " ")  # Em space
        code = code.replace("\u2009", " ")  # Thin space
        code = code.replace("\u200a", " ")  # Hair space
        code = code.replace("\u200b", "")  # Zero-width space
        code = code.replace("\ufeff", "")  # Zero-width no-break space (BOM)
        return code

    def _extract_code_to_script(self, code_block, page_num, code_index):
        """
        Extract code block to independent script file
        """
        line_threshold = self.scripts_config.get("line_threshold", 30)
        min_quality = self.scripts_config.get("min_quality_score", 6.0)

        code = code_block.get("code", "")
        language = code_block.get("language", "txt")
        quality_score = code_block.get("quality_score", 0)

        # Clean whitespace issues first
        code = self._clean_code_whitespace(code)

        # Remove leading blank lines and check first non-blank line
        lines = code.split("\n")
        first_non_blank_idx = 0
        for i, line in enumerate(lines):
            if line.strip():  # Found first non-blank line
                first_non_blank_idx = i
                break

        if first_non_blank_idx < len(lines):
            first_non_blank_line = lines[first_non_blank_idx]
            # Don't extract code that starts with indentation (class methods, not standalone functions)
            # But allow shebang lines and docstrings
            if first_non_blank_line and first_non_blank_line[0] in (" ", "\t"):
                # Check if it's a shebang or docstring (common at start of scripts)
                stripped = first_non_blank_line.strip()
                if not (
                    stripped.startswith("#!")
                    or stripped.startswith('"""')
                    or stripped.startswith("'''")
                ):
                    return None

        # Reconstruct code without leading blank lines
        code = "\n".join(lines[first_non_blank_idx:])

        # Check if extraction is needed
        line_count = len(code.split("\n"))

        if line_count < line_threshold:
            return None

        if quality_score < min_quality:
            return None

        # Generate filename
        script_filename = self._generate_script_filename(
            language, page_num, code_index, code
        )

        script_dir = os.path.join(self.skill_dir, "scripts")
        os.makedirs(script_dir, exist_ok=True)

        script_path = os.path.join(script_dir, script_filename)

        # Add source comments
        code_content = self._add_source_comments(code, language, page_num, self.name)

        # Save script file
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(code_content)

        # Record script information
        script_info = {
            "filename": script_filename,
            "relative_path": f"scripts/{script_filename}",
            "absolute_path": script_path,
            "language": language,
            "line_count": line_count,
            "quality_score": quality_score,
            "page_number": page_num,
            "code_index": code_index,
        }

        self.extracted_scripts.append(script_info)
        return script_info

    def _generate_script_filename(self, language, page_num, code_index, code):
        """Generate meaningful script filename"""
        name_hint = self._extract_code_name_hint(code, language)

        if name_hint:
            base_name = name_hint
        else:
            base_name = f"example_page{page_num}_code{code_index}"

        ext = self._get_file_extension(language)
        safe_name = re.sub(r"[^\w\-]", "_", base_name)

        return f"{safe_name}.{ext}"

    def _extract_code_name_hint(self, code, language):
        """Extract meaningful name from code"""
        if language == "python":
            match = re.search(r"class\s+([a-zA-Z_][a-zA-Z0-9_]*)", code)
            if match:
                return match.group(1)
            match = re.search(r"def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", code)
            if match:
                return match.group(1)
        elif language in ["javascript", "typescript", "js", "ts"]:
            match = re.search(r"function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(", code)
            if match:
                return match.group(1)
            match = re.search(
                r"(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\(", code
            )
            if match:
                return match.group(1)
        elif language in ["java", "cpp", "c", "csharp"]:
            match = re.search(
                r"(?:public|private|protected)?\s*(?:static)?\s*\w+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(",
                code,
            )
            if match:
                return match.group(1)
            match = re.search(r"class\s+([a-zA-Z_][a-zA-Z0-9_]*)", code)
            if match:
                return match.group(1)
        elif language == "go":
            match = re.search(r"func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", code)
            if match:
                return match.group(1)

        return None

    def _get_file_extension(self, language):
        """Get file extension based on language"""
        extensions = {
            "python": "py",
            "javascript": "js",
            "typescript": "ts",
            "java": "java",
            "cpp": "cpp",
            "c": "c",
            "csharp": "cs",
            "go": "go",
            "rust": "rs",
            "ruby": "rb",
            "php": "php",
            "swift": "swift",
            "kotlin": "kt",
            "scala": "scala",
            "r": "r",
            "matlab": "m",
            "bash": "sh",
            "shell": "sh",
            "sql": "sql",
            "json": "json",
            "yaml": "yaml",
            "xml": "xml",
            "html": "html",
            "css": "css",
        }
        return extensions.get(language.lower(), "txt")

    def _add_source_comments(self, code, language, page_num, doc_name):
        """Add source attribution comments to code"""
        comment_styles = {
            "python": "#",
            "ruby": "#",
            "bash": "#",
            "shell": "#",
            "r": "#",
            "yaml": "#",
            "javascript": "//",
            "typescript": "//",
            "java": "//",
            "cpp": "//",
            "c": "//",
            "csharp": "//",
            "go": "//",
            "rust": "//",
            "swift": "//",
            "kotlin": "//",
            "scala": "//",
            "php": "//",
        }

        comment_char = comment_styles.get(language.lower(), "#")

        header = f"""{comment_char} Source: {doc_name} Documentation (Page {page_num})
{comment_char} Extracted by Skill Seekers
{comment_char}
{comment_char} This code example is from the official documentation.
{comment_char} You can modify and use it for your projects.

"""

        return header + code

    def _generate_scripts_readme(self):
        """Generate README.md for scripts/ directory"""
        if not self.extracted_scripts:
            return

        readme_path = os.path.join(self.skill_dir, "scripts", "README.md")

        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(f"# {self.name.title()} - Code Examples\n\n")
            f.write(
                "This directory contains executable code examples extracted from the documentation.\n\n"
            )
            f.write("## Available Scripts\n\n")

            # Group by language
            scripts_by_lang = {}
            for script in self.extracted_scripts:
                lang = script["language"]
                if lang not in scripts_by_lang:
                    scripts_by_lang[lang] = []
                scripts_by_lang[lang].append(script)

            # Generate table for each language
            for lang, scripts in sorted(scripts_by_lang.items()):
                f.write(f"### {lang.upper()}\n\n")
                f.write("| Script | Lines | Quality | Page |\n")
                f.write("|--------|-------|---------|------|\n")

                for script in scripts:
                    filename = script["filename"]
                    relative_path = script["relative_path"]
                    line_count = script["line_count"]
                    quality = script["quality_score"]
                    page_num = script["page_number"]

                    f.write(
                        f"| [{filename}]({relative_path}) | {line_count} | {quality:.1f}/10 | {page_num} |\n"
                    )

                f.write("\n")

            f.write("## Usage\n\n")
            f.write("1. Navigate to the desired script directory\n")
            f.write("2. Download or copy the script file\n")
            f.write("3. Run it in your local environment\n\n")

            f.write("## Notes\n\n")
            f.write("- All scripts include source attribution comments\n")
            f.write("- Scripts are extracted from official documentation\n")
            f.write("- Quality scores indicate code completeness and correctness\n\n")

            f.write("---\n\n")
            f.write("*Generated by Skill Seekers*\n")

        print(f"   Generated: scripts/README.md")


def main():
    parser = argparse.ArgumentParser(
        description="Convert Markdown documentation to Claude skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # From file
  python md_scraper.py --md document.md --name my_skill

  # From stdin (text input)
  cat document.md | python md_scraper.py --text --name my_skill
  echo "# Title\nContent" | python md_scraper.py --text --name my_skill

  # From config file
  python md_scraper.py --config config.json

  # From extracted JSON
  python md_scraper.py --from-json extracted.json
        """,
    )

    parser.add_argument("--config", help="Markdown config JSON file")
    parser.add_argument("--md", "--file", dest="md", help="Direct Markdown file path")
    parser.add_argument(
        "--text",
        "--stdin",
        dest="text",
        action="store_true",
        help="Read markdown content from stdin (text input)",
    )
    parser.add_argument(
        "--content", help="Markdown content string (alternative to --text)"
    )
    parser.add_argument(
        "--name", help="Skill name (required with --md, --text, or --content)"
    )
    parser.add_argument("--from-json", help="Build skill from extracted JSON")
    parser.add_argument("--description", help="Skill description")

    args = parser.parse_args()

    # Validate inputs
    if not (args.config or args.md or args.text or args.content or args.from_json):
        parser.error("Must specify --config, --md, --text, --content, or --from-json")

    # Handle text input from stdin
    md_content = None
    if args.text:
        if not args.name:
            parser.error("--name is required when using --text")
        print("Reading markdown content from stdin...")
        import sys

        md_content = sys.stdin.read()
        if not md_content.strip():
            parser.error("No content read from stdin")
    elif args.content:
        if not args.name:
            parser.error("--name is required when using --content")
        md_content = args.content

    # Load or create config
    if args.config:
        with open(args.config, "r") as f:
            config = json.load(f)
        # Allow overriding md_content/md_path from command line
        if md_content:
            config["md_content"] = md_content
        elif args.md:
            config["md_path"] = args.md
    elif args.from_json:
        # Build from extracted JSON
        name = Path(args.from_json).stem.replace("_extracted", "")
        config = {
            "name": name,
            "description": args.description
            or f"Use when referencing {name} documentation",
        }
        converter = MarkdownToSkillConverter(config)
        converter.load_extracted_data(args.from_json)
        converter.build_skill()
        return
    else:
        # Direct Markdown mode (from file or text input)
        if not args.name:
            parser.error("Must specify --name with --md, --text, or --content")

        # Determine input source
        if md_content:
            # Text content input
            input_source = {"md_content": md_content}
        elif args.md:
            # File path input
            input_source = {"md_path": args.md}
        else:
            parser.error("Must specify either --md, --text, or --content")

        config = {
            "name": args.name,
            "description": args.description
            or f"Use when referencing {args.name} documentation",
            **input_source,
        }

    # Create converter
    converter = MarkdownToSkillConverter(config)

    # Extract if needed
    if config.get("md_path") or config.get("md_content"):
        if not converter.extract_markdown():
            sys.exit(1)

    # Build skill
    converter.build_skill()


if __name__ == "__main__":
    main()
