default:
	just --list

build:
	npm run check && npm run typecheck && npm test

format:
	npm run format

format-check:
	npm run format:check

lint:
	npm run lint

check:
	npm run check

typecheck:
	npm run typecheck

test:
	npm test

coverage:
	npm run coverage

pack:
	npm run preview:package
