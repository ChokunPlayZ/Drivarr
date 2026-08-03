package main

import (
	"strings"
	"testing"
)

func TestFrontendMountsReactApplication(t *testing.T) {
	if !strings.Contains(indexHTML, `id="root"`) {
		t.Fatal("index.html does not contain the React mount point")
	}
	if !strings.Contains(indexHTML, `type="module"`) {
		t.Fatal("React bundle is not loaded as a module")
	}
	if !strings.Contains(appJS, "createRoot") {
		t.Fatal("embedded application is not a React bundle")
	}
}

func TestFrontendDoesNotUseCSPBlockedInlineStyles(t *testing.T) {
	if strings.Contains(appJS, "style=") {
		t.Fatal("app.js contains an inline style, but the application CSP forbids inline styles")
	}
}
