const USER_DISPLAY_NAMES: Record<string, string> = {
  chihya72: 'pm',
}

export function displayUser(user: string): string {
  return USER_DISPLAY_NAMES[user] || user
}
