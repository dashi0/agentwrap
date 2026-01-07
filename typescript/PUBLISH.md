# Publishing to npm

## Prerequisites

1. **npm Account**: Make sure you have an npm account
   - Sign up at https://www.npmjs.com/signup
   - Verify your email

2. **npm Login**: Login to npm on your machine
   ```bash
   npm login
   ```

3. **Access Rights**: Ensure you have publish rights to the `agentwrap` package
   - First publish: Package name must be available
   - Subsequent publishes: You must be a collaborator

## Pre-Publish Checklist

Before publishing, ensure:

- [ ] All tests pass: `npm test`
- [ ] Code is linted: `npm run lint`
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] Version number is updated appropriately
- [ ] CHANGELOG is updated (if exists)
- [ ] README is up to date

## Publishing Steps

### 1. **Dry Run** (Recommended first!)

Test what will be published without actually publishing:

```bash
npm run publish:dry
```

This shows you:
- What files will be included
- Package size
- Any warnings or errors

### 2. **Update Version**

Use semantic versioning:

```bash
# Patch release (0.1.0 → 0.1.1) - Bug fixes
npm run version:patch

# Minor release (0.1.0 → 0.2.0) - New features, backwards compatible
npm run version:minor

# Major release (0.1.0 → 1.0.0) - Breaking changes
npm run version:major
```

Or manually:
```bash
npm version <new-version>
```

### 3. **Publish**

```bash
npm publish
```

For first publish, or if you need public access:
```bash
npm publish --access public
```

### 4. **Tag Release on GitHub**

After successful publish:

```bash
git push --tags
git push origin master
```

Then create a GitHub release at:
https://github.com/dashi0/agentwrap/releases/new

## Published Package Info

- **Package Name**: `agentwrap`
- **npm URL**: https://www.npmjs.com/package/agentwrap
- **Install Command**: `npm install agentwrap`

## What Gets Published

Files included (defined in `package.json` "files" field):
- `dist/` - Built JavaScript files
- `README.md` - Package documentation
- `LICENSE` - License file

Files excluded (via `.npmignore`):
- Source TypeScript files (`src/`)
- Tests (`tests/`)
- Config files (`.eslintrc.json`, `tsconfig.json`, etc.)
- Development files

## Troubleshooting

### "You do not have permission to publish"

Solution: Login with correct account or request access
```bash
npm logout
npm login
```

### "Package name already exists"

Solutions:
1. Choose a different name in `package.json`
2. Or use scoped package: `@username/agentwrap`

### "prepublishOnly script failed"

Fix the failing checks:
```bash
npm run lint        # Fix linting errors
npm run typecheck   # Fix TypeScript errors
npm run test        # Fix failing tests
```

### Version already published

You cannot republish the same version. Update version:
```bash
npm run version:patch
npm publish
```

## Post-Publish

After successful publish:

1. **Verify on npm**: Visit https://www.npmjs.com/package/agentwrap
2. **Test installation**: In a new directory:
   ```bash
   mkdir test-install
   cd test-install
   npm init -y
   npm install agentwrap
   ```
3. **Update GitHub Release**: Create release notes
4. **Announce**: Share on social media, Discord, etc.

## Unpublishing (Emergency Only!)

⚠️ **Warning**: Only use within 72 hours of publish, and avoid if possible!

```bash
npm unpublish agentwrap@<version>
```

Better alternative: Publish a patch version with fixes.

## Automation (Future)

Consider setting up:
- GitHub Actions for automated publishing
- Semantic release for automatic versioning
- Changesets for changelog management

## Support

- npm docs: https://docs.npmjs.com/
- Issues: https://github.com/dashi0/agentwrap/issues
