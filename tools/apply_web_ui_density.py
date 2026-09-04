from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


player = Path("apps/web/src/player/PlayerBar.tsx")
old_info = '''            {episode.artworkUrl && <img src={episode.artworkUrl} alt="" />}
            <p className="eyebrow">{episode.podcastTitle}</p>
            <h2>{episode.title}</h2>
            <p>
              {episode.publishedAt
                ? new Date(episode.publishedAt).toLocaleDateString()
                : ""}{" "}
              · {time(displayDurationMs)}
            </p>
            <div className="show-notes">{notes(episode.descriptionHtml)}</div>
            {episode.episodeUrl && (
              <a href={episode.episodeUrl} target="_blank" rel="noreferrer">
                Open episode source
              </a>
            )}
'''
new_info = '''            {episode.artworkUrl && <img src={episode.artworkUrl} alt="" />}
            <div className="episode-info-copy">
              <p className="eyebrow">{episode.podcastTitle}</p>
              <h2>{episode.title}</h2>
              <p>
                {episode.publishedAt
                  ? new Date(episode.publishedAt).toLocaleDateString()
                  : ""}{" "}
                · {time(displayDurationMs)}
              </p>
              <div className="show-notes">{notes(episode.descriptionHtml)}</div>
              {episode.episodeUrl && (
                <a href={episode.episodeUrl} target="_blank" rel="noreferrer">
                  Open episode source
                </a>
              )}
            </div>
'''
replace_once(player, old_info, new_info)

css = Path("apps/web/src/styles/main.css")
css_text = css.read_text(encoding="utf-8")
old_grid = "grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));"
if css_text.count(old_grid) != 2:
    raise SystemExit(f"Expected two desktop podcast grid declarations, found {css_text.count(old_grid)}")
css_text = css_text.replace(
    old_grid,
    "grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));",
)
old_episode_art = '''.episode-info > img {
  width: min(100%, 18rem);
  margin-top: 1.5rem;
  border-radius: 1rem;
}

.episode-info {
  position: relative;
}
'''
new_episode_art = '''.episode-info > img {
  width: min(70%, 12.5rem);
  aspect-ratio: 1;
  display: block;
  margin: 2.25rem auto 1.25rem;
  object-fit: cover;
  border-radius: 0.85rem;
}

.episode-info {
  position: relative;
}

.episode-info-copy {
  padding: 0 0.75rem 2rem;
}
'''
if old_episode_art not in css_text:
    raise SystemExit("Expected episode info artwork block not found")
css_text = css_text.replace(old_episode_art, new_episode_art, 1)
anchor = '''.cast-controls {
  gap: 0.05rem;
}

@media (max-width: 980px) {
'''
compact = '''.cast-controls {
  gap: 0.05rem;
}

.queue-drawer .secondary,
.queue-drawer .danger,
.profile-page .secondary,
.profile-page .danger {
  min-height: 1.9rem;
  padding: 0.36rem 0.68rem;
  border-radius: 0.5rem;
  font-size: 0.72rem;
}

.queue-drawer .clear {
  width: max-content;
  display: block;
  margin: 1rem 0 0 auto;
}

.profile-page .danger {
  width: auto;
  margin-left: auto;
}

@media (max-width: 980px) {
'''
if anchor not in css_text:
    raise SystemExit("Expected compact-control insertion point not found")
css_text = css_text.replace(anchor, compact, 1)
css.write_text(css_text, encoding="utf-8")

changelog = Path("CHANGELOG.md")
text = changelog.read_text(encoding="utf-8")
marker = "## Unreleased\n\n"
entry = (
    "- Refined the web episode information drawer with smaller centred artwork and\n"
    "  padded copy, compacted queue/profile action buttons, and reduced desktop\n"
    "  podcast tiles by roughly ten percent for a denser library layout.\n"
)
if marker not in text:
    raise SystemExit("Unreleased changelog marker not found")
changelog.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")
