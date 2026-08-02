.PHONY: build test vet run package

VERSION ?= 0.1.0
BUILD_DIR ?= build

build:
	mkdir -p $(BUILD_DIR)
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(BUILD_DIR)/drivarrd ./cmd/drivarrd
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o $(BUILD_DIR)/drivarrctl ./cmd/drivarrctl

test:
	go test -count=1 ./...

vet:
	go vet ./...

run:
	go run ./cmd/drivarrd --listen 127.0.0.1:8787 --data-dir ./drivarr-data

package: build
	./packaging/build-deb.sh $(VERSION) $(BUILD_DIR)/drivarrd $(BUILD_DIR)/drivarrctl
