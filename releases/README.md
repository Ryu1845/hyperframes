# Release notes

Reviewed GitHub Release bodies live here.

Create the next draft with:

```bash
bun run changelog:draft <version> --write
```

It drafts `releases/v<version>.md` and the matching `docs/changelog.mdx` entry. Rewrite the generated TODO summary, then bump the versions with `bun run set-version <version> --no-tag`.

Pass the file as the release body when you publish: `gh release create v<version> --notes-file releases/v<version>.md`. Keep these notes user-facing; implementation details can stay in pull requests. See [Release channels](../docs/contributing/release-channels.mdx).
