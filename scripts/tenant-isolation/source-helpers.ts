// Reading the app's own source for the checks on the code itself
// (ui-polish-checks.ts): its pages and components, and the opening tags of
// the elements they render, with their attributes as written.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

// One file of the repo, by its path from the repo root.
export async function read(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

// Where the app's own code lives (scripts/ are these checks). Files in the
// repo root count too: a proxy.ts or middleware.ts would sit there.
const APP_SOURCE_FOLDERS = ["adapters", "app", "components", "db", "lib", "services"];

// Every .ts and .tsx file of the app's own code, as paths from the repo root.
export async function appSourceFiles(): Promise<string[]> {
  const isSourceFile = (fileName: string) => /\.tsx?$/.test(fileName);
  const files = (await readdir(ROOT)).filter(isSourceFile);
  for (const folder of APP_SOURCE_FOLDERS) {
    const entries = await readdir(path.join(ROOT, folder), { recursive: true });
    files.push(...entries.filter(isSourceFile).map((entry) => path.join(folder, entry)));
  }
  return files;
}

// Every .tsx file under app/ and components/, as paths from the repo root.
export async function pageSources(): Promise<string[]> {
  const files: string[] = [];
  for (const folder of ["app", "components"]) {
    const entries = await readdir(path.join(ROOT, folder), { recursive: true });
    files.push(...entries.filter((entry) => entry.endsWith(".tsx")).map((entry) => path.join(folder, entry)));
  }
  return files;
}

// The source without its comments, so a tag a comment names ("after a
// <form action> runs") isn't taken for one. A "//" counts only after a
// space or at a line's start, so "https://" in a string stays.
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

// The opening tag of every element with one of these names in a source
// file, as written. A ">" inside {...} (an arrow function) or on a "//"
// comment line between the attributes doesn't end the tag.
export function openingTags(source: string, names: string[]): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(new RegExp(`<(?:${names.join("|")})\\b`, "g"))) {
    let depth = 0;
    let end = match.index;
    while (end < source.length && !(source[end] === ">" && depth === 0)) {
      if (depth === 0 && source.startsWith("//", end)) {
        const lineEnd = source.indexOf("\n", end);
        end = lineEnd === -1 ? source.length : lineEnd;
        continue;
      }
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

// The opening tag of every <select> and <NativeSelect> in a source file.
export function selectTags(source: string): string[] {
  return openingTags(source, ["select", "NativeSelect"]);
}

// One attribute's value in an opening tag, as written ({...} with spaces
// squeezed, or "..."), or null when the tag doesn't have it.
export function attributeValue(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}=`).exec(tag);
  if (!match) {
    return null;
  }
  const start = match.index + match[0].length;
  if (tag[start] === '"') {
    return tag.slice(start, tag.indexOf('"', start + 1) + 1);
  }
  let depth = 0;
  for (let end = start; end < tag.length; end++) {
    if (tag[end] === "{") depth += 1;
    if (tag[end] === "}") depth -= 1;
    if (depth === 0) {
      return tag.slice(start, end + 1).replace(/\s+/g, " ");
    }
  }
  return null;
}
