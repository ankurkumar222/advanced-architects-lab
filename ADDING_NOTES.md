# Adding New Notes

Every note in this repo automatically gets:
- **Audio recording panels** per section (paste a Google Drive link, plays inline)
- **Sync to GitHub** button (commits all recording links as a JSON file)

Two shared files power all of this — `audio-sync.css` and `audio-sync.js` at the repo root. New notes just reference them; no copy-pasting of styles or logic needed.

---

## Checklist for a new note

### 1. Create the file in its own subfolder

```
new-topic design/
  my_note.html
```

All existing notes live one level deep, so `../audio-sync.css` always reaches the root.

---

### 2. Link the shared stylesheet in `<head>`

```html
<head>
  <!-- your existing styles -->
  <link rel="stylesheet" href="../audio-sync.css">
</head>
```

---

### 3. Drop an audio panel placeholder after each section heading

Place an empty `<div class="audio-panel" id="audio-panel-{id}">` immediately after your section's heading div. The `id` must match the section IDs you'll list in the config (step 4).

**Segment-style notes** (heading on one line):
```html
<section class="segment" id="s1" style="--seg:#C9871F">
  <div class="segment-head"><span class="segment-offset">offset 00</span><h2>Your topic title</h2></div>
  <div class="audio-panel" id="audio-panel-s1"></div>
  <!-- rest of section content -->
</section>

<section class="segment" id="s2" style="--seg:#2E8B82">
  <div class="segment-head"><span class="segment-offset">offset 01</span><h2>Next topic</h2></div>
  <div class="audio-panel" id="audio-panel-s2"></div>
  <!-- rest of section content -->
</section>
```

**Stage-style notes** (build-your-own style):
```html
<section class="stage" id="st0" style="--seg:#C1543A">
  <div class="stage-head"><span class="stage-num">Stage 0</span><h2>First stage</h2></div>
  <div class="audio-panel" id="audio-panel-st0"></div>
</section>
```

Any consistent ID scheme works (`s1`/`s2`, `st0`/`st1`, `ch1`/`ch2`, etc.) — just be consistent between the HTML and the config below.

---

### 4. Add the config + script just before `</body>`

```html
<script>
window.ALAB_PAGE_CONFIG = {
  storageKey: 'alab_audio_data_my_note_v1',   // unique per file — avoids data collisions
  metaKey:    'alab_audio_meta_my_note_v1',
  topicIds:   ['s1', 's2', 's3'],              // must match your audio-panel IDs above
  ghPath:     'audio-data/my_note.json'        // path in the repo where recordings are saved
};
</script>
<script src="../audio-sync.js"></script>
</body>
```

`storageKey` and `metaKey` just need to be unique — use the filename as the suffix to keep them distinct.

---

## Full minimal example

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>My New Note</title>
<link rel="stylesheet" href="../audio-sync.css">
<style>
  /* your note's own styles */
</style>
</head>
<body>

<section id="s1">
  <h2>Section one</h2>
  <div class="audio-panel" id="audio-panel-s1"></div>
  <p>Content here…</p>
</section>

<section id="s2">
  <h2>Section two</h2>
  <div class="audio-panel" id="audio-panel-s2"></div>
  <p>Content here…</p>
</section>

<script>
window.ALAB_PAGE_CONFIG = {
  storageKey: 'alab_audio_data_my_new_note_v1',
  metaKey:    'alab_audio_meta_my_new_note_v1',
  topicIds:   ['s1', 's2'],
  ghPath:     'audio-data/my_new_note.json'
};
</script>
<script src="../audio-sync.js"></script>
</body>
</html>
```

---

## How the audio panel works

| Action | What happens |
|--------|-------------|
| Paste a Google Drive share link + click **+ Add recording** | Drive player embeds in the panel |
| Click **⇪ Sync to GitHub** | Opens settings on first use; commits recording data as JSON to your repo |
| Settings (⚙) | Enter owner, repo, branch, PAT once — optionally remembered in `localStorage` |
| Recordings | Stored locally in `localStorage` per note; synced on demand |

---

## Updating the shared feature

Edit `audio-sync.css` or `audio-sync.js` at the repo root — all notes pick up the change automatically on next page load. No per-file edits needed.
