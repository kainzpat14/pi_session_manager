#!/usr/bin/env node
/**
 * Mock pi process for testing.
 * Draws a simple fake TUI, responds to SIGWINCH, and echoes typed input.
 */

const ESC = '\x1b[';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

let promptBuffer = '';
let running = true;

function draw() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  // Clear screen and home cursor
  process.stdout.write(`${ESC}2J${ESC}H`);
  process.stdout.write(`${CYAN}${BOLD}MOCK PI${RESET} — test process (cols=${cols}, rows=${rows})\n`);
  process.stdout.write(`${'─'.repeat(Math.min(cols, 40))}\n\n`);
  process.stdout.write(`${GREEN}> ${RESET}${promptBuffer}`);
}

function emitPrompt() {
  process.stdout.write(`\n${GREEN}> ${RESET}`);
  promptBuffer = '';
}

process.on('SIGWINCH', () => {
  if (running) draw();
});

process.on('SIGINT', () => {
  process.stdout.write(`\n${RED}[SIGINT]${RESET}\n`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

process.stdin.on('data', (data) => {
  if (!running) return;
  const str = data.toString();
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code === 3) {          // Ctrl+C
      process.stdout.write('\n');
      process.exit(0);
    }
    if (code === 13) {         // Enter
      const cmd = promptBuffer.trim();
      promptBuffer = '';
      process.stdout.write('\n');
      if (cmd === 'exit') {
        running = false;
        process.exit(0);
      }
      if (cmd === 'clear') {
        draw();
        continue;
      }
      if (cmd) {
        process.stdout.write(`echo: ${cmd}\n`);
      }
      emitPrompt();
      continue;
    }
    if (code === 127) {        // Backspace
      if (promptBuffer.length > 0) {
        promptBuffer = promptBuffer.slice(0, -1);
      }
      continue;
    }
    if (code >= 32 && code < 127) {
      promptBuffer += ch;
    }
  }
  // Redraw with current buffer on cursor area
  // For simplicity, we just redraw after each keystroke
  draw();
});

// Initial draw
draw();

// Keep process alive
setInterval(() => {}, 1000);
