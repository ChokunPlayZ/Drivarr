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

func TestGeneratedReportsStartAFileDownload(t *testing.T) {
	if !strings.Contains(appJS, "location.assign") {
		t.Fatal("generated reports are not sent to the browser download endpoint")
	}
	if !strings.Contains(appJS, "/download") {
		t.Fatal("frontend bundle does not contain the report download route")
	}
}

func TestFrontendIncludesCompleteDrivePreset(t *testing.T) {
	if !strings.Contains(appJS, "complete-drive-check") || !strings.Contains(appJS, "Complete drive check") {
		t.Fatal("frontend bundle does not expose the complete drive test preset")
	}
}
