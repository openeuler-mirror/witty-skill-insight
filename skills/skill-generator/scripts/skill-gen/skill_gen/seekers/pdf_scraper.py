#!/usr/bin/env python3
"""
PDF Documentation to Claude Skill Converter (Task B1.6)

Converts PDF documentation into Claude AI skills.
Uses pdf_extractor_poc.py for extraction, builds skill structure.

Usage:
    python3 pdf_scraper.py --config configs/manual_pdf.json
    python3 pdf_scraper.py --pdf manual.pdf --name myskill
    python3 pdf_scraper.py --from-json manual_extracted.json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF, used here for hyperlink extraction

from ..skill_name_gen import normalize_skill_name

# Import the PDF extractor
from .pdf_extractor_poc import PDFExtractor


def infer_description_from_pdf(pdf_metadata: dict = None, name: str = "") -> str:
    """
    Infer skill description from PDF metadata or document properties.

    Tries to extract meaningful description from:
    1. PDF metadata fields (title, subject, keywords)
    2. Falls back to improved template

    Args:
        pdf_metadata: PDF metadata dictionary with title, subject, etc.
        name: Skill name for fallback

    Returns:
        Description string suitable for "Use when..." format
    """
    if pdf_metadata:
        # Try to use subject field (often contains description)
        if "subject" in pdf_metadata and pdf_metadata["subject"]:
            desc = str(pdf_metadata["subject"]).strip()
            if len(desc) > 20:
                if len(desc) > 150:
                    desc = desc[:147] + "..."
                return f"Use when {desc.lower()}"

        # Try title field if meaningful
        if "title" in pdf_metadata and pdf_metadata["title"]:
            title = str(pdf_metadata["title"]).strip()
            # Skip if it's just the filename
            if len(title) > 10 and not title.endswith(".pdf"):
                return f"Use when working with {title.lower()}"

    # Improved fallback
    return (
        f"Use when referencing {name} documentation"
        if name
        else "Use when referencing this documentation"
    )


class PDFToSkillConverter:
    """Convert PDF documentation to Claude skill"""

    def __init__(self, config):
        self.config = config
        self.normalize_name = bool(config.get("normalize_name", True))
        self.name = config["name"]
        self.skill_name = (
            normalize_skill_name(self.name, max_length=64, fallback_prefix="skill")
            if self.normalize_name
            else self.name
        )
        self.pdf_path = config.get("pdf_path", "")
        # Set initial description (will be improved after extraction if metadata available)
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
            {
                "line_threshold": 30,
                "min_quality_score": 6.0,
                "max_display_lines": 5,  # 在 reference 中显示的最大行数，超过则显示简化格式
            },
        )

        # Extraction options
        self.extract_options = config.get("extract_options", {})

        # Categories
        self.categories = config.get("categories", {})

        # Extracted data
        self.extracted_data = None

        # Scripts tracking
        self.extracted_scripts = []

        # Cache for extracted PDF hyperlinks
        self._pdf_links = None

    def extract_pdf(self):
        """Extract content from PDF using pdf_extractor_poc.py"""
        print(f"\n🔍 Extracting from PDF: {self.pdf_path}")

        # Create extractor with options
        extractor = PDFExtractor(
            self.pdf_path,
            verbose=True,
            chunk_size=self.extract_options.get("chunk_size", 10),
            min_quality=self.extract_options.get("min_quality", 5.0),
            extract_images=self.extract_options.get("extract_images", True),
            image_dir=f"{self.skill_dir}/assets/images",
            min_image_size=self.extract_options.get("min_image_size", 100),
        )

        # Extract
        result = extractor.extract_all()

        if not result:
            print("❌ Extraction failed")
            raise RuntimeError(f"Failed to extract PDF: {self.pdf_path}")

        # Save extracted data
        with open(self.data_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"\n💾 Saved extracted data to: {self.data_file}")
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

        # Use chapters if available
        if self.extracted_data.get("chapters"):
            for chapter in self.extracted_data["chapters"]:
                category_key = self._sanitize_filename(chapter["title"])
                categorized[category_key] = {"title": chapter["title"], "pages": []}

            # Assign pages to chapters
            for page in self.extracted_data["pages"]:
                page_num = page["page_number"]

                # Find which chapter this page belongs to
                for chapter in self.extracted_data["chapters"]:
                    if chapter["start_page"] <= page_num <= chapter["end_page"]:
                        category_key = self._sanitize_filename(chapter["title"])
                        categorized[category_key]["pages"].append(page)
                        break

        # Fall back to keyword-based categorization
        elif self.categories:
            # Check if categories is already in the right format (for tests)
            # If first value is a list of dicts (pages), use as-is
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
                # Initialize categories
                for cat_key, keywords in self.categories.items():
                    categorized[cat_key] = {
                        "title": cat_key.replace("_", " ").title(),
                        "pages": [],
                    }

                # Categorize by keywords
                for page in self.extracted_data["pages"]:
                    text = page.get("text", "").lower()
                    headings_text = " ".join(
                        [h["text"] for h in page.get("headings", [])]
                    ).lower()

                    # Score against each category
                    scores = {}
                    for cat_key, keywords in self.categories.items():
                        # Handle both string keywords and dict keywords (shouldn't happen, but be safe)
                        if isinstance(keywords, list):
                            score = sum(
                                1
                                for kw in keywords
                                if isinstance(kw, str)
                                and (kw.lower() in text or kw.lower() in headings_text)
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
            print(
                f"   ✅ Extracted {len(self.extracted_scripts)} scripts to scripts/ directory"
            )

        # Generate guides index from PDF hyperlinks (if any)
        self._generate_guides_index()

        # Generate SKILL.md
        self._generate_skill_md(categorized)

        print(f"\n✅ Skill built successfully: {self.skill_dir}/")
        print(f"\n📦 Next step: Package with: skill-seekers package {self.skill_dir}/")

    def _extract_pdf_links(self):
        """
        Extract hyperlink targets and associated text from the source PDF,
        and normalize them into simple {name, url} items.

        Returns:
            list[dict]: Each item has keys: name, url
        """
        if self._pdf_links is not None:
            return self._pdf_links

        if not self.pdf_path:
            self._pdf_links = []
            return self._pdf_links

        pdf_path = Path(self.pdf_path)
        if not pdf_path.exists():
            print(f"⚠️  PDF file for link extraction not found: {pdf_path}")
            self._pdf_links = []
            return self._pdf_links

        print(f"\n🔗 Extracting hyperlinks from PDF: {pdf_path}")

        items = []
        seen = set()
        try:
            with fitz.open(pdf_path) as doc:
                for page_index in range(len(doc)):
                    page = doc[page_index]
                    page_links = page.get_links()
                    if not page_links:
                        continue

                    for link in page_links:
                        uri = link.get("uri")
                        if not uri:
                            continue

                        rect = link.get("from")
                        if rect is None:
                            continue

                        # Clip text within the hyperlink rectangle to get visible label
                        link_rect = fitz.Rect(rect)
                        text = page.get_text("text", clip=link_rect).strip()

                        name = text or ""
                        url = uri or ""
                        if not url:
                            continue

                        key = (name, url)
                        if key in seen:
                            continue
                        seen.add(key)

                        items.append(
                            {
                                "name": name,
                                "url": url,
                            }
                        )
        except Exception as e:
            print(f"⚠️  Failed to extract hyperlinks from PDF: {e}")
            items = []

        print(f"   ✅ Found {len(items)} unique hyperlinks in PDF")
        self._pdf_links = items
        return self._pdf_links

    def _generate_guides_index(self):
        """
        Generate guides/index.json under the skill directory
        containing PDF hyperlinks in a simple [{name, url}] format.
        """
        links = self._extract_pdf_links()
        if not links:
            return

        guides_dir = os.path.join(self.skill_dir, "guides")
        os.makedirs(guides_dir, exist_ok=True)

        index_path = os.path.join(guides_dir, "index.json")

        # links 已经是 [{name, url}] 的简化结构
        # 移除 name 字段中的换行符和空格，并过滤掉名称小于5个字符的链接
        cleaned_links = []
        for link in links:
            name = re.sub(r"[\r\n]+", " ", link.get("name", "")).strip()
            # 去除所有空格
            name = name.replace(" ", "")
            # 过滤掉名称小于5个字符的链接
            if len(name) < 5:
                continue
            cleaned_link = {"name": name, "url": link.get("url", "")}
            cleaned_links.append(cleaned_link)

        # 如果没有有效的链接，不生成文件
        if not cleaned_links:
            print(f"   ⚠️  No valid links found, skipping guides index")
            return

        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(cleaned_links, f, indent=2, ensure_ascii=False)

        print(
            f"   ✅ Generated guides index: {index_path} ({len(cleaned_links)} items, filtered from {len(links)} total)"
        )

    def _generate_reference_file(self, cat_key, cat_data):
        """Generate a reference markdown file for a category"""
        filename = f"{self.skill_dir}/references/{cat_key}.md"

        with open(filename, "w", encoding="utf-8") as f:
            f.write(f"# {cat_data['title']}\n\n")

            for page in cat_data["pages"]:
                # Add headings as section markers
                if page.get("headings"):
                    f.write(f"## {page['headings'][0]['text']}\n\n")

                # Add text content
                if page.get("text"):
                    # Limit to first 1000 chars per page to avoid huge files
                    text = page["text"][:10000]
                    f.write(f"{text}\n\n")

                # Add code samples (check both 'code_samples' and 'code_blocks' for compatibility)
                code_list = page.get("code_samples") or page.get("code_blocks")
                if code_list:
                    # First pass: identify which code blocks are extracted to scripts/
                    # Track by language to avoid showing any code from same language if one is extracted
                    extracted_languages = set()
                    script_references = {}  # lang -> script_info

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
                            # Store only the first (longest) script reference for each language
                            if lang not in script_references:
                                script_references[lang] = {
                                    "filename": script_info["filename"],
                                    "relative_path": script_info["relative_path"],
                                    "line_count": line_count,
                                    "quality": code.get("quality_score", 0),
                                }

                    # Second pass: generate output
                    # If a language has extracted scripts, only show reference once, skip all code blocks
                    f.write("### Code Examples\n\n")

                    # Show script references for extracted languages
                    max_display_lines = self.scripts_config.get("max_display_lines", 5)
                    for lang, ref_info in script_references.items():
                        line_count = ref_info["line_count"]
                        # 如果行数超过阈值，显示简化格式
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
                    # Create assets directory if needed
                    assets_dir = os.path.join(self.skill_dir, "assets")
                    os.makedirs(assets_dir, exist_ok=True)

                    f.write("### Images\n\n")
                    for img in page["images"]:
                        # Save image to assets
                        img_filename = (
                            f"page_{page['page_number']}_img_{img['index']}.png"
                        )
                        img_path = os.path.join(assets_dir, img_filename)

                        with open(img_path, "wb") as img_file:
                            img_file.write(img["data"])

                        # Add markdown image reference
                        f.write(
                            f"![Image {img['index']}](../assets/{img_filename})\n\n"
                        )

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
        # Remove special chars, replace spaces with underscores
        safe = re.sub(r"[^\w\s-]", "", name.lower())
        safe = re.sub(r"[-\s]+", "_", safe)
        return safe

    def _clean_code_whitespace(self, code):
        """
        Clean non-standard whitespace characters from code.

        Fixes:
        - Replaces non-breaking spaces (U+00A0) with regular spaces
        - Normalizes other Unicode whitespace to standard spaces
        - Preserves code structure and indentation

        Args:
            code: Code string with potential whitespace issues

        Returns:
            str: Cleaned code with standard whitespace
        """
        # Replace non-breaking space (U+00A0) with regular space
        code = code.replace("\xa0", " ")

        # Replace other common non-standard spaces
        code = code.replace("\u2002", " ")  # En space
        code = code.replace("\u2003", " ")  # Em space
        code = code.replace("\u2009", " ")  # Thin space
        code = code.replace("\u200a", " ")  # Hair space

        # Replace zero-width spaces (invisible characters that can break parsing)
        code = code.replace("\u200b", "")  # Zero-width space
        code = code.replace("\ufeff", "")  # Zero-width no-break space (BOM)

        return code

    def _extract_code_to_script(self, code_block, page_num, code_index):
        """
        Extract code block to independent script file

        Args:
            code_block: Code block dict (containing code, language, quality_score, etc.)
            page_num: Page number
            code_index: Code block index within page

        Returns:
            dict: Script file info, or None if extraction not needed
        """
        # Get configuration
        line_threshold = self.scripts_config.get("line_threshold", 30)
        min_quality = self.scripts_config.get("min_quality_score", 6.0)

        # Get code information
        code = code_block.get("code", "")
        language = code_block.get("language", "txt")
        quality_score = code_block.get("quality_score", 0)

        # Don't extract code that starts with indentation (class methods, not standalone functions)
        if code and code[0] in (" ", "\t"):
            return None

        # Clean whitespace issues (non-breaking spaces, etc.)
        code = self._clean_code_whitespace(code)

        # Check if extraction is needed
        line_count = len(code.split("\n"))

        # Check line count threshold
        if line_count < line_threshold:
            return None

        # Check quality threshold
        if quality_score < min_quality:
            return None

        # Generate filename
        script_filename = self._generate_script_filename(
            language, page_num, code_index, code
        )

        # Use flat directory structure (no language subdirectories)
        script_dir = os.path.join(self.skill_dir, "scripts")
        os.makedirs(script_dir, exist_ok=True)

        script_path = os.path.join(script_dir, script_filename)

        # Always add source comments
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
        """
        Generate meaningful script filename

        Args:
            language: Programming language
            page_num: Page number
            code_index: Code block index
            code: Code content

        Returns:
            str: Filename
        """
        # Try to extract function/class name from code
        name_hint = self._extract_code_name_hint(code, language)

        # If meaningful name extracted
        if name_hint:
            base_name = name_hint
        else:
            # Use default naming
            base_name = f"example_page{page_num}_code{code_index}"

        # Add language extension
        ext = self._get_file_extension(language)

        # Sanitize filename (remove special characters)
        safe_name = re.sub(r"[^\w\-]", "_", base_name)

        return f"{safe_name}.{ext}"

    def _extract_code_name_hint(self, code, language):
        """
        Extract meaningful name from code (function name, class name, etc.)

        Args:
            code: Code content
            language: Programming language

        Returns:
            str: Extracted name, or None
        """
        # Python
        if language == "python":
            # Match class definition FIRST (prioritize class name over function name)
            match = re.search(r"class\s+([a-zA-Z_][a-zA-Z0-9_]*)", code)
            if match:
                return match.group(1)

            # Match function definition: def function_name(
            match = re.search(r"def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", code)
            if match:
                return match.group(1)

        # JavaScript/TypeScript
        elif language in ["javascript", "typescript", "js", "ts"]:
            # Match function: function functionName(
            match = re.search(r"function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(", code)
            if match:
                return match.group(1)

            # Match arrow function: const functionName = (
            match = re.search(
                r"(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\(", code
            )
            if match:
                return match.group(1)

        # Java/C++/C#
        elif language in ["java", "cpp", "c", "csharp"]:
            # Match method: public void methodName(
            match = re.search(
                r"(?:public|private|protected)?\s*(?:static)?\s*\w+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(",
                code,
            )
            if match:
                return match.group(1)

            # Match class: class ClassName
            match = re.search(r"class\s+([a-zA-Z_][a-zA-Z0-9_]*)", code)
            if match:
                return match.group(1)

        # Go
        elif language == "go":
            # Match function: func FunctionName(
            match = re.search(r"func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", code)
            if match:
                return match.group(1)

        return None

    def _get_file_extension(self, language):
        """
        Get file extension based on language

        Args:
            language: Programming language

        Returns:
            str: File extension
        """
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
        """
        Add source attribution comments to code

        Args:
            code: Original code
            language: Programming language
            page_num: Page number
            doc_name: Document name

        Returns:
            str: Code with added comments
        """
        # Get comment symbol
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

        # Generate comment header
        header = f"""{comment_char} Source: {doc_name} Documentation (Page {page_num})
{comment_char} Extracted by Skill Seekers
{comment_char}
{comment_char} This code example is from the official documentation.
{comment_char} You can modify and use it for your projects.

"""

        return header + code


def main():
    parser = argparse.ArgumentParser(
        description="Convert PDF documentation to Claude skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--config", help="PDF config JSON file")
    parser.add_argument("--pdf", help="Direct PDF file path")
    parser.add_argument("--name", help="Skill name (with --pdf)")
    parser.add_argument("--from-json", help="Build skill from extracted JSON")
    parser.add_argument("--description", help="Skill description")

    args = parser.parse_args()

    # Validate inputs
    if not (args.config or args.pdf or args.from_json):
        parser.error("Must specify --config, --pdf, or --from-json")

    # Load or create config
    if args.config:
        with open(args.config, "r") as f:
            config = json.load(f)
    elif args.from_json:
        # Build from extracted JSON
        name = Path(args.from_json).stem.replace("_extracted", "")
        config = {
            "name": name,
            "description": args.description
            or f"Use when referencing {name} documentation",
        }
        converter = PDFToSkillConverter(config)
        converter.load_extracted_data(args.from_json)
        converter.build_skill()
        return
    else:
        # Direct PDF mode
        if not args.name:
            parser.error("Must specify --name with --pdf")
        config = {
            "name": args.name,
            "pdf_path": args.pdf,
            "description": args.description
            or f"Use when referencing {args.name} documentation",
            "extract_options": {
                "chunk_size": 10,
                "min_quality": 5.0,
                "extract_images": True,
                "min_image_size": 100,
            },
        }

    # Create converter
    converter = PDFToSkillConverter(config)

    # Extract if needed
    if config.get("pdf_path"):
        if not converter.extract_pdf():
            sys.exit(1)

    # Build skill
    converter.build_skill()


if __name__ == "__main__":
    main()
