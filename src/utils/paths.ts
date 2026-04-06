import { homedir } from 'os';

export function expandHomeDir(path: string): string {
  if (path.startsWith('~/')) {
    return path.replace('~', homedir());
  }
  return path;
}

export function collapseHomeDir(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return path.replace(home, '~');
  }
  return path;
}
