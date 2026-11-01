// Shared locators for the current UI (3.6+ layout: a sidebar of projects with threads, a top bar switching views).

// Waits until the project is the selected one: its sidebar row (role treeitem) has aria-selected="true".
export async function waitProjectOpen(page, name, options) {
  await page.locator('[data-crew-row][aria-selected="true"]').filter({ hasText: name }).first().waitFor(options)
}
