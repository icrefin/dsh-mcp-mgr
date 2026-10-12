/**
 * Sidebar glyph of the MCP manager panel entry.
 */

import type { ReactNode } from 'react'
import { IconApiOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the MCP glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function McpPanelIcon({ size }: SidebarPanelIconOwnerProps): ReactNode {
  return <IconApiOutlineRegular size={size} />
}