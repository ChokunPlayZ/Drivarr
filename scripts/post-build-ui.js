const fs = require('fs');
const path = require('path');

const appJsPath = path.resolve(__dirname, '../cmd/drivarrd/web/app.js');
let code = fs.readFileSync(appJsPath, 'utf8');

// Step 1: Ensure strict/abstract equality comparisons with "style" have spaces around operators
code = code.replace(/style===/g, 'style === ').replace(/style==/g, 'style == ');

// Step 2: Replace assignment style= with "style = " (only when not followed by =)
code = code.replace(/\bstyle=(?!=)/g, 'style = ');

fs.writeFileSync(appJsPath, code);

// Step 3: Validate that the resulting JavaScript bundle is syntactically valid
try {
  new Function(code);
  console.log('UI bundle post-processed successfully with valid JS syntax.');
} catch (err) {
  console.error('UI bundle post-processing failed syntax validation:', err);
  process.exit(1);
}
