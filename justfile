default:
	just --list

build:
	npm run typecheck && npm test

typecheck:
	npm run typecheck

test:
	npm test

link:
	npm run link

unlink:
	npm run unlink

pack:
	npm run preview:package
