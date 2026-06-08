const { execSync } = require('child_process');
const path = require('path');

const ROOT = 'E:/domin/Desktop/tamers_quest_web';

// Collect all exports from src/ and server/ (excluding test files and compat shim)
function grepExports(dir) {
  try {
    const out = execSync(
      `rg -n --no-heading "export (function|const|let|var|class) (\\w+)" ${dir} --glob "*.js" --glob "!*.test.js" --glob "!kaboomShim.js"`,
      { encoding: 'utf8', maxBuffer: 10*1024*1024, cwd: ROOT }
    );
    return out.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

const lines = [...grepExports('src'), ...grepExports('server')];

const exports_list = [];
for (const line of lines) {
  const m = line.match(/^(.+?):(\d+):export\s+(?:function|const|let|var|class)\s+(\w+)/);
  if (m) {
    exports_list.push({ file: m[1].replace(/\\/g, '/'), lineNum: parseInt(m[2]), name: m[3] });
  }
}

console.log(`Found ${exports_list.length} exports to check...`);

// For each export, check if the name is referenced in any OTHER file
const dead = [];
for (const exp of exports_list) {
  try {
    const result = execSync(
      `rg -l --glob "*.js" --glob "!*.test.js" --glob "!_find_dead_exports.js" "\\b${exp.name}\\b" src server`,
      { encoding: 'utf8', maxBuffer: 10*1024*1024, cwd: ROOT }
    ).trim().split('\n').filter(Boolean);

    const normalizedExpFile = exp.file.replace(/\\/g, '/');
    const otherFiles = result
      .map(f => f.replace(/\\/g, '/'))
      .filter(f => f !== normalizedExpFile);

    if (otherFiles.length === 0) {
      dead.push(exp);
    }
  } catch (e) {
    // rg returns exit code 1 if no matches -- that means truly dead
    if (e.status === 1) {
      dead.push(exp);
    }
  }
}

console.log('\n=== DEAD EXPORTS (symbol not found in any other non-test file) ===\n');
for (const d of dead) {
  console.log(`${d.file}:${d.lineNum}  ${d.name}`);
}
console.log(`\nTotal dead exports: ${dead.length}`);
