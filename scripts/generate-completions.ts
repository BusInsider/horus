#!/usr/bin/env node
// Generate shell completions for Horus

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMANDS = [
  { name: 'init', description: 'Initialize Horus configuration' },
  { name: 'chat', description: 'Start an interactive chat session' },
  { name: 'run', description: 'Execute a single task and exit' },
  { name: 'plan', description: 'Generate a plan without executing' },
  { name: 'execute', description: 'Execute a plan file' },
  { name: 'rollback', description: 'Rollback to a checkpoint' },
  { name: 'sessions', description: 'List all saved sessions' },
  { name: 'checkpoints', description: 'List checkpoints for current session' },
  { name: 'config', description: 'Show current configuration' },
  { name: 'configure', description: 'Interactive configuration wizard' },
  { name: 'mcp', description: 'Configure MCP servers' },
  { name: 'workspace', description: 'Set or show the default workspace' },
  { name: 'doctor', description: 'Run diagnostic checks' },
];

const GLOBAL_OPTIONS = [
  { name: '-V, --version', description: 'Output the version number' },
  { name: '-h, --help', description: 'Display help for command' },
  { name: '-v, --verbose', description: 'Enable verbose output' },
  { name: '-q, --quiet', description: 'Suppress non-error output' },
  { name: '--debug', description: 'Enable debug mode' },
  { name: '--dry-run', description: 'Show what would be done without executing' },
];

function generateBashCompletions(): string {
  return `# Horus CLI bash completions
# Install: Copy to /etc/bash_completion.d/horus or source in ~/.bashrc

_horus_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local commands="${COMMANDS.map(c => c.name).join(' ')}"

  case \${COMP_CWORD} in
    1)
      COMPREPLY=( $(compgen -W "\${commands}" -- \${cur}) )
      ;;
    2)
      case \${prev} in
        chat)
          COMPREPLY=( $(compgen -W "--resume --plan" -- \${cur}) )
          ;;
        run|plan|checkpoints|rollback)
          COMPREPLY=( $(compgen -W "--path" -- \${cur}) ;;
        configure)
          COMPREPLY=( $(compgen -W "--reset --test" -- \${cur}) ;;
        workspace)
          COMPREPLY=( $(compgen -d -- \${cur}) )
          ;;
        *)
          COMPREPLY=()
          ;;
      esac
      ;;
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _horus_completions horus
`;
}

function generateZshCompletions(): string {
  return `#compdef horus
# Horus CLI zsh completions
# Install: Copy to /usr/local/share/zsh/site-functions/_horus

_horus_commands() {
  local commands
  commands=(
${COMMANDS.map(c => `    "${c.name}:${c.description}"`).join('\n')}
  )
  _describe -t commands 'horus commands' commands
}

_horus() {
  local curcontext="$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-V --version)'{-V,--version}'[Show version]' \\
    '(-v --verbose)'{-v,--verbose}'[Enable verbose output]' \\
    '(-q --quiet)'{-q,--quiet}'[Suppress non-error output]' \\
    '--debug[Enable debug mode]' \\
    '--dry-run[Show what would be done without executing]' \\
    '1: :_horus_commands' \\
    '*:: :->args'

  case "$line[1]" in
    chat)
      _arguments \\
        '--resume[Resume a previous session]' \\
        '--plan[Enable plan mode]'
      ;;
    run)
      _arguments \\
        '--path[Working directory]:directory:_directories' \\
        '--plan[Use plan mode]'
      ;;
    configure)
      _arguments \\
        '--reset[Reset to defaults]' \\
        '--test[Test API connection]'
      ;;
    workspace)
      _path_files -/
      ;;
  esac
}

compdef _horus horus
`;
}

function generateFishCompletions(): string {
  const completions: string[] = [];

  // Global options
  completions.push('complete -c horus -s h -l help -d "Show help"');
  completions.push('complete -c horus -s V -l version -d "Show version"');
  completions.push('complete -c horus -s v -l verbose -d "Enable verbose output"');
  completions.push('complete -c horus -s q -l quiet -d "Suppress non-error output"');
  completions.push('complete -c horus -l debug -d "Enable debug mode"');
  completions.push('complete -c horus -l dry-run -d "Show what would be done"');

  // Commands
  for (const cmd of COMMANDS) {
    completions.push(`complete -c horus -n "__fish_use_subcommand" -a "${cmd.name}" -d "${cmd.description}"`);
  }

  // Command-specific options
  completions.push('complete -c horus -n "__fish_seen_subcommand_from chat" -l resume -d "Resume session"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from chat" -l plan -d "Enable plan mode"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from run" -l path -d "Working directory" -a "(__fish_complete_directories)"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from run" -l plan -d "Use plan mode"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from plan" -l path -d "Working directory" -a "(__fish_complete_directories)"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from configure" -l reset -d "Reset to defaults"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from configure" -l test -d "Test API connection"');
  completions.push('complete -c horus -n "__fish_seen_subcommand_from workspace" -a "(__fish_complete_directories)"');

  return completions.join('\n') + '\n';
}

// Generate completions
const outputDir = process.argv[2] || join(__dirname, '..', 'completions');

try {
  mkdirSync(outputDir, { recursive: true });
} catch {
  // Directory might already exist
}

writeFileSync(join(outputDir, 'horus.bash'), generateBashCompletions());
writeFileSync(join(outputDir, 'horus.zsh'), generateZshCompletions());
writeFileSync(join(outputDir, 'horus.fish'), generateFishCompletions());

console.log(`✅ Generated shell completions in ${outputDir}/`);
console.log('');
console.log('Install:');
console.log('  Bash: sudo cp completions/horus.bash /etc/bash_completion.d/horus');
console.log('  Zsh:  sudo cp completions/horus.zsh /usr/local/share/zsh/site-functions/_horus');
console.log('  Fish: cp completions/horus.fish ~/.config/fish/completions/');
console.log('');
console.log('Or source directly:');
console.log('  source completions/horus.bash');
