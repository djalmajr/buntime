## What's New

### plugin-proxy
- Drag-and-drop rule ordering with priority control
- Enable/disable rules without deleting (toggle via API and UI)
- Reorder API endpoint (`PUT /api/rules/reorder`)
- Toggle API endpoint (`PATCH /api/rules/:id/toggle`)
- Drag preview shows full row clone
- Drawer no longer drags when selecting text

### cpanel
- Fixed z-frame scroll overflow on embedded views

### Docker
- Pinned Bun to v1.3.8 (avoids segfault in 1.3.9+)

### Helm
- Versioned chart publishing (each version preserved in charts repo)
- Release notes displayed in Rancher chart listing via `app-readme.md`
- Chart README with configuration reference
