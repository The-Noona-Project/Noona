import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command ${command} ${args.join(' ')} failed with exit code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

function cleanJavadoc(comment) {
  return comment
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trimEnd())
    .join('\n')
    .trim();
}

function determineJavaKind(signature) {
  if (/\bclass\b/.test(signature)) {
    return 'class';
  }
  if (/\binterface\b/.test(signature)) {
    return 'interface';
  }
  if (/\benum\b/.test(signature)) {
    return 'enum';
  }
  if (/\b@interface\b/.test(signature)) {
    return 'annotation';
  }
  if (signature.includes('(')) {
    return 'method';
  }
  return 'field';
}

function extractJavaName(signature, kind) {
  if (kind === 'class') {
    const match = signature.match(/class\s+([A-Za-z_$][\w$]*)/);
    return match ? match[1] : null;
  }
  if (kind === 'interface') {
    const match = signature.match(/interface\s+([A-Za-z_$][\w$]*)/);
    return match ? match[1] : null;
  }
  if (kind === 'enum') {
    const match = signature.match(/enum\s+([A-Za-z_$][\w$]*)/);
    return match ? match[1] : null;
  }
  if (kind === 'annotation') {
    const match = signature.match(/@interface\s+([A-Za-z_$][\w$]*)/);
    return match ? match[1] : null;
  }
  if (kind === 'method') {
    const parenIndex = signature.indexOf('(');
    if (parenIndex === -1) return null;
    const beforeParen = signature.slice(0, parenIndex).trim();
    const tokens = beforeParen.split(/\s+/);
    return tokens.length ? tokens[tokens.length - 1].replace(/<.*>/, '') : null;
  }
  if (kind === 'field') {
    const tokens = signature.split(/\s+/);
    return tokens.length ? tokens[tokens.length - 1].replace(/;$/, '') : null;
  }
  return null;
}

async function collectFiles(dir, extension) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath, extension);
    }
    if (entry.isFile() && fullPath.endsWith(extension)) {
      return [fullPath];
    }
    return [];
  }));

  return files.flat();
}

function stripLeadingAnnotations(text) {
  let index = 0;

  const isIdentifierChar = (char) => /[A-Za-z0-9_$.]/.test(char);

  while (index < text.length) {
    // Skip whitespace before the next token.
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }

    if (text[index] !== '@') {
      break;
    }

    index += 1; // Skip '@'

    while (index < text.length && isIdentifierChar(text[index])) {
      index += 1;
    }

    if (text[index] === '(') {
      let depth = 1;
      index += 1;
      while (index < text.length && depth > 0) {
        const char = text[index];
        if (char === '(') {
          depth += 1;
        } else if (char === ')') {
          depth -= 1;
        }
        index += 1;
      }
    }

    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }
  }

  return text.slice(index);
}

async function buildJsDocs() {
  const { stdout } = await runCommand('npx', ['jsdoc', '-X', '-c', path.join('docs', 'jsdoc.json')], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'production' },
  });

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Unable to parse JSDoc output: ${error.message}`);
  }
}

async function buildJavaDocs() {
  const javaSourceDir = path.join(repoRoot, 'services', 'raven', 'src', 'main', 'java');
  let stats;
  try {
    stats = await fs.stat(javaSourceDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const files = await collectFiles(javaSourceDir, '.java');
  const docs = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    let index = 0;
    while (true) {
      const start = content.indexOf('/**', index);
      if (start === -1) {
        break;
      }
      const end = content.indexOf('*/', start + 3);
      if (end === -1) {
        break;
      }

      const commentBody = content.slice(start + 3, end);
      const afterComment = content.slice(end + 2);
      const signatureSource = stripLeadingAnnotations(afterComment);
      const signatureMatch = signatureSource.match(/^\s*[^{;]+/);
      if (!signatureMatch) {
        index = end + 2;
        continue;
      }

      const signature = signatureMatch[0]
        .replace(/\s+/g, ' ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .trim();
      const kind = determineJavaKind(signature);
      const name = extractJavaName(signature, kind);
      if (!name) {
        index = end + 2;
        continue;
      }

      docs.push({
        file: path.relative(repoRoot, filePath),
        name,
        kind,
        signature,
        description: cleanJavadoc(commentBody),
      });

      index = end + 2;
    }
  }

  return docs;
}

async function main() {
  const [jsdoc, javadoc] = await Promise.all([buildJsDocs(), buildJavaDocs()]);

  const output = {
    generatedAt: new Date().toISOString(),
    jsdoc,
    javadoc,
  };

  const docsDir = path.join(repoRoot, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  const destination = path.join(docsDir, 'docs.json');
  await fs.writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
