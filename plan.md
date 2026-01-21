# Wonka Clone Factory - Project Plan

## Overview
Website cloning tool that captures static HTML, CSS, JS, and assets from any public webpage with interactive element support for cloned pages.

**Reference:** See README.md for full feature list

---

## Task List

```json
[
  {
    "category": "bugfix",
    "description": "Fix interactive elements on cloned pages",
    "steps": [
      "Ensure cart drawer opens/closes properly",
      "Ensure Add to Cart buttons provide feedback",
      "Ensure bundle option buttons are selectable",
      "Test quantity +/- buttons",
      "Verify all buttons have cursor:pointer"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Improve image carousel functionality",
    "steps": [
      "Make thumbnail images clickable",
      "Update main image when thumbnail clicked",
      "Add visual feedback for selected thumbnail",
      "Test carousel arrow buttons"
    ],
    "passes": false
  },
  {
    "category": "optimization",
    "description": "Test download optimization feature",
    "steps": [
      "Test ZIP download with optimize=true",
      "Verify HTML minification works",
      "Verify image WebP conversion works",
      "Compare file sizes before/after optimization"
    ],
    "passes": false
  },
  {
    "category": "ui",
    "description": "Verify clone management UI",
    "steps": [
      "Test folder creation and deletion",
      "Test clone rename functionality",
      "Test clone move to folder",
      "Test clone delete with confirmation",
      "Verify drag-drop to folders works"
    ],
    "passes": false
  },
  {
    "category": "testing",
    "description": "End-to-end clone workflow test",
    "steps": [
      "Clone a new website",
      "Edit the clone (change links, images)",
      "Save changes",
      "Download optimized version",
      "Verify all features work together"
    ],
    "passes": false
  }
]
```

---

## Agent Instructions

1. Read `activity.md` first to understand current state
2. Find next task with `"passes": false`
3. Complete all steps for that task
4. Verify in browser using Playwright
5. Update task to `"passes": true`
6. Log completion in `activity.md`
7. Repeat until all tasks pass

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.

---

## Completion Criteria
All tasks marked with `"passes": true`
