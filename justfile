# Run all checks (lint, format check, typecheck, tests)
gate: lint fmt-check typecheck test

# Lint source code
lint:
    bunx biome lint src/ tests/

# Fix lint issues
lint-fix:
    bunx biome lint --fix src/ tests/

# Check formatting
fmt-check:
    bunx biome format src/ tests/

# Format source code
fmt:
    bunx biome format --fix src/ tests/

# Typecheck
typecheck:
    bunx tsc --noEmit

# Run all tests
test: test-unit test-integration test-e2e

# Run unit tests
test-unit:
    bun test tests/unit/

# Run integration tests
test-integration:
    bun test tests/integration/

# Run e2e tests
test-e2e:
    bun test tests/e2e/
