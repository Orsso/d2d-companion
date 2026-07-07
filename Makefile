UUID := d2d-companion@orsso.github.io
SCHEMA_DIR := $(UUID)/schemas
DIST_DIR := dist
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: check lint test schema pack install clean

check: lint test schema

lint:
	./node_modules/.bin/eslint $(UUID) tests eslint.config.js

test:
	gjs -m tests/run.js
	bash tests/packageVerifier.test.sh

schema:
	glib-compile-schemas --strict --dry-run $(SCHEMA_DIR)

pack: check
	mkdir -p $(DIST_DIR)
	gnome-extensions pack --force --out-dir=$(DIST_DIR) \
		--extra-source=lib \
		--extra-source=hover-background-hidden.css \
		--extra-source=focused-app-background-hidden.css \
		--extra-source=dash-hover-background-hidden.css \
		--extra-source=../README.md \
		--extra-source=../LICENSE \
		$(UUID)
	bash scripts/verify-package.sh $(DIST_DIR)/$(UUID).shell-extension.zip

install: pack
	gnome-extensions install --force $(DIST_DIR)/$(UUID).shell-extension.zip
	glib-compile-schemas $(INSTALL_DIR)/schemas

clean:
	rm -rf $(DIST_DIR) $(SCHEMA_DIR)/gschemas.compiled
