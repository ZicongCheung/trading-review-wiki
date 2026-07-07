import fs from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { execFile, execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { promisify } from "node:util"
import { readFileSync } from "node:fs"

import {
  defaultConvertedSourcePath,
  ensureDirectory,
  execFileAsync,
  exists,
  isConvertibleSourcePath,
  isPdfSourcePath,
  normalizePath,
  nowLocalTimestamp,
  projectRelative,
  sha256Hex,
  yamlString,
} from "./core.mjs"

export function renderConvertedSourceMarkdown({
  sourcePath,
  sourceHash,
  outputPath,
  convertedAt,
  converter,
  conversionNote,
  content,
}) {
  const title = path.basename(sourcePath, path.extname(sourcePath))
  const body = String(content ?? "").trim()
  const frontmatter = [
    "---",
    'converted_schema: "markitdown-sidecar-v1"',
    `source_file: ${yamlString(sourcePath)}`,
    `source_basename: ${yamlString(path.basename(sourcePath))}`,
    `source_sha256: ${yamlString(sourceHash)}`,
    `output_file: ${yamlString(outputPath)}`,
    `converted_at: ${yamlString(convertedAt)}`,
    `converter: ${yamlString(converter)}`,
    ...(conversionNote ? [`conversion_note: ${yamlString(conversionNote)}`] : []),
    "---",
  ]
  return [
    ...frontmatter,
    "",
    `# ${title}`,
    "",
    `> Converted from \`${path.basename(sourcePath)}\` for text ingest and raw retrieval.`,
    "",
    body,
    "",
  ].join("\n")
}

export async function resolveExecutablePath(command) {
  if (command.includes("/") || path.isAbsolute(command)) return normalizePath(command)
  const { stdout } = await execFileAsync("/usr/bin/env", ["which", command], {
    maxBuffer: 1024 * 1024,
  })
  const resolved = stdout.trim().split(/\r?\n/).filter(Boolean)[0]
  if (!resolved) throw new Error(`Executable not found on PATH: ${command}`)
  return normalizePath(resolved)
}

export function pythonFromShebang(firstLine) {
  const shebang = String(firstLine ?? "").trim()
  if (!shebang.startsWith("#!")) return null
  const command = shebang.slice(2).trim()
  if (!command) return null
  if (command.includes("/env ")) {
    const parts = command.split(/\s+/).filter(Boolean)
    return parts[1] ?? null
  }
  return command.split(/\s+/)[0] ?? null
}

export async function inferPythonFromConverter(converter) {
  const executable = await resolveExecutablePath(converter)
  const firstLine = (await fs.readFile(executable, "utf8")).split(/\r?\n/, 1)[0]
  return pythonFromShebang(firstLine) ?? "python3"
}

export const PDF_RENDER_SCRIPT = String.raw`
import json
import sys
from pathlib import Path

try:
    import pypdfium2 as pdfium
except Exception as exc:
    raise SystemExit(f"pypdfium2_unavailable: {exc}")

pdf_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
scale = float(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)
pdf = pdfium.PdfDocument(str(pdf_path))
pages = []
for idx in range(len(pdf)):
    page = pdf[idx]
    image = page.render(scale=scale).to_pil()
    image_path = out_dir / f"page-{idx + 1:04d}.png"
    image.save(image_path)
    pages.append(str(image_path))
print(json.dumps({"pageCount": len(pages), "images": pages}, ensure_ascii=False))
`

export const MACOS_VISION_OCR_SWIFT = String.raw`
import Foundation
import Vision
import AppKit

var pages: [[String: Any]] = []
for (idx, path) in CommandLine.arguments.dropFirst().enumerated() {
  autoreleasepool {
    let url = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: url),
          let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let cgImage = bitmap.cgImage else {
      pages.append(["page": idx + 1, "text": "", "error": "failed_to_load_image"])
      return
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

    do {
      try handler.perform([request])
      let observations = request.results ?? []
      let lines = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
      }
      pages.append(["page": idx + 1, "text": lines.joined(separator: "\n")])
    } catch {
      pages.append(["page": idx + 1, "text": "", "error": String(describing: error)])
    }
  }
}

let data = try JSONSerialization.data(withJSONObject: pages, options: [])
print(String(data: data, encoding: .utf8)!)
`

export function renderOcrPagesMarkdown(pages) {
  return pages
    .map((page) => {
      const pageNo = page.page ?? "?"
      const text = String(page.text ?? "").trim()
      const body = text || "_OCR produced no text for this page._"
      return [`## Page ${pageNo}`, "", body].join("\n")
    })
    .join("\n\n")
}

export async function convertPdfWithMacVisionOcr(options) {
  if (process.platform !== "darwin") {
    throw new Error("macOS Vision OCR fallback is only available on macOS.")
  }
  const sourcePath = normalizePath(options.sourcePath)
  const converter = options.markitdownBin ?? process.env.MARKITDOWN_BIN ?? "markitdown"
  const pythonBin = options.ocrPythonBin ?? process.env.MARKITDOWN_OCR_PYTHON ?? await inferPythonFromConverter(converter)
  const scale = Number(options.ocrScale ?? 2)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "markitdown-ocr-"))
  try {
    const imagesDir = path.join(tmpDir, "pages")
    const renderScriptPath = path.join(tmpDir, "render-pdf.py")
    const swiftScriptPath = path.join(tmpDir, "vision-ocr.swift")
    await fs.writeFile(renderScriptPath, PDF_RENDER_SCRIPT, "utf8")
    await fs.writeFile(swiftScriptPath, MACOS_VISION_OCR_SWIFT, "utf8")

    const rendered = await execFileAsync(pythonBin, [renderScriptPath, sourcePath, imagesDir, String(scale)], {
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 128,
    })
    const renderPayload = JSON.parse(rendered.stdout)
    const imagePaths = Array.isArray(renderPayload.images) ? renderPayload.images : []
    if (imagePaths.length === 0) {
      throw new Error(`PDF renderer produced no page images for ${sourcePath}`)
    }

    const ocrResult = await execFileAsync("swift", [swiftScriptPath, ...imagePaths], {
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 128,
      timeout: options.ocrTimeoutMs ?? 10 * 60 * 1000,
    })
    const pages = JSON.parse(ocrResult.stdout)
    const pageCharCounts = pages.map((page) => String(page.text ?? "").trim().length)
    const content = renderOcrPagesMarkdown(pages)
    if (!content.replace(/## Page \d+\s*/g, "").trim()) {
      throw new Error(`macOS Vision OCR produced empty text for ${sourcePath}`)
    }
    return {
      content,
      converter: "macOS Vision OCR",
      conversionNote: "MarkItDown produced empty Markdown; PDF pages were rendered and recognized with macOS Vision OCR.",
      pages: pages.length,
      pageCharCounts,
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function markitdownMissingMessage(converter) {
  return [
    `MarkItDown converter not found: ${converter}`,
    "Install it first, for example:",
    "  pip install 'markitdown[pdf,docx,pptx,xlsx]'",
    "For broader format support:",
    "  pip install 'markitdown[all]'",
  ].join("\n")
}

export async function convertSourceWithMarkitdown(options) {
  const sourcePath = normalizePath(options.sourcePath)
  if (!isConvertibleSourcePath(sourcePath)) {
    throw new Error(`Unsupported source type for convert-source: ${sourcePath}`)
  }
  if (!(await exists(sourcePath))) {
    throw new Error(`Source file not found: ${sourcePath}`)
  }

  const outputPath = normalizePath(options.outputPath ?? defaultConvertedSourcePath(sourcePath))
  if (!options.overwrite && await exists(outputPath)) {
    throw new Error(`Converted sidecar already exists: ${outputPath}. Use --overwrite to replace it.`)
  }

  const converter = options.markitdownBin ?? process.env.MARKITDOWN_BIN ?? "markitdown"
  let stdout = ""
  let effectiveConverter = converter
  let conversionNote = null
  let ocrPages = null
  let ocrPageCharCounts = null
  try {
    const result = await execFileAsync(converter, [sourcePath], {
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 128,
    })
    stdout = result.stdout
  } catch (err) {
    if (err?.code === "ENOENT") throw new Error(markitdownMissingMessage(converter))
    const stderr = String(err?.stderr ?? "").trim()
    const detail = stderr ? `\n${stderr.slice(0, 2000)}` : ""
    throw new Error(`MarkItDown conversion failed for ${sourcePath}.${detail}`)
  }

  if (!stdout.trim()) {
    if (isPdfSourcePath(sourcePath) && options.ocrFallback !== false) {
      try {
        const ocrRunner = options.ocrRunner ?? convertPdfWithMacVisionOcr
        const ocr = await ocrRunner({
          sourcePath,
          markitdownBin: converter,
          ocrPythonBin: options.ocrPythonBin,
          ocrScale: options.ocrScale,
          ocrTimeoutMs: options.ocrTimeoutMs,
          maxBuffer: options.maxBuffer,
        })
        stdout = ocr.content ?? ""
        effectiveConverter = `${converter} empty-output + ${ocr.converter ?? "OCR fallback"}`
        conversionNote = ocr.conversionNote ?? "MarkItDown produced empty Markdown; OCR fallback was used."
        ocrPages = ocr.pages ?? null
        ocrPageCharCounts = ocr.pageCharCounts ?? null
      } catch (ocrErr) {
        const message = ocrErr instanceof Error ? ocrErr.message : String(ocrErr)
        throw new Error(`MarkItDown produced empty Markdown for ${sourcePath}; OCR fallback failed: ${message}`)
      }
    }
    if (!stdout.trim()) {
      throw new Error(`MarkItDown produced empty Markdown for ${sourcePath}`)
    }
  }

  const sourceBytes = await fs.readFile(sourcePath)
  const sourceHash = sha256Hex(sourceBytes)
  const convertedAt = nowLocalTimestamp()
  const markdown = renderConvertedSourceMarkdown({
    sourcePath,
    sourceHash,
    outputPath,
    convertedAt,
    converter: effectiveConverter,
    conversionNote,
    content: stdout,
  })

  await ensureDirectory(path.dirname(outputPath))
  await fs.writeFile(outputPath, markdown, "utf8")

  const projectPath = options.projectPath ? normalizePath(options.projectPath) : null
  return {
    sourcePath,
    outputPath,
    sourceHash,
    convertedAt,
    converter: effectiveConverter,
    conversionNote,
    ocrPages,
    ocrPageCharCounts,
    bytes: Buffer.byteLength(markdown, "utf8"),
    sourceRelativePath: projectPath ? projectRelative(projectPath, sourcePath) : null,
    outputRelativePath: projectPath ? projectRelative(projectPath, outputPath) : null,
  }
}
