# Debug report — TreeView hover exit binding

- Symptom: entering the authenticated app shell caused the tree view to throw `unknown type: mouseleave` and leave the page blank.
- Root cause: `mouseleave` was registered after `.transition()`, so D3 parsed it as a transition event instead of a DOM selection event.
- Fix: bind `mouseleave` on the `.node-main-circle` selection first, then run the existing 420 ms transition on that same selection.
- Regression: `test/treeViewEvents.test.js` failed against the old source and passes after the fix.
- Browser evidence: local controlled browser showed the tree canvas, `#root` child count `1`, `[role=tree]` present, and `4` rendered nodes; no TreeView error was recorded. Existing local no-config Supabase mock still reports missing `.limit()` in chat/review hooks.
- Verification: `npm test` 24/24, lint 0 errors with 5 existing warnings, and `npm run build` passed.
- Cleanup: the temporary local auth route, environment file, dev process, browser pages, and logs were removed. No cloud, database, deployment, or commit changed.
- Status: DONE
