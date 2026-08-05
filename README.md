# Drivarr

Drivarr is a single-host Linux drive-diagnostics daemon with an authenticated
Material Design 3 web interface.

## Standalone UI demo

The complete interactive demo is in [`demo/`](./demo). Open
`demo/index.html` directly in a browser; it has no build step, backend, network
requests, or hardware access.

## Features

- SATA, SAS, NVMe, and USB-backed Linux block-device discovery
- One-click safe eject that powers off idle drives before physical removal
- Guarded single-partition drive setup with GPT/MBR and optional ext4 formatting
- SMART telemetry and short, extended, and conveyance self-tests, with
  automatic detection and progress display for tests already running in drive
  firmware
- Seagate FARM collection when the drive and transport expose it
- Full-screen per-drive workspace with live progress, sector mapping, complete
  SMART attributes, flattened FARM metrics, and retained test history
- Heuristic SMART-history consistency checks using independent FARM counters
- Sequential throughput and random-read IOPS benchmarks
- Full non-destructive bad-block scans with exact failing offsets
- Ordered complete-drive preset: speed benchmark, full error scan, then extended
  offline SMART self-test
- Destructive chunked write/read CRC32C verification
- Durable pause, resume, cancellation, restart checkpoints, and progress
- Hardware-process deadlines, process-group isolation, circuit breaking, and
  manual quarantine for drives that wedge in kernel I/O
- Local administrator, operator, and viewer accounts
- Advanced validated test profiles and versioned grading policies
- Immutable audit history and configurable report retention
- Tamper-evident, test-aware per-test and full-drive PDF reports, canonical JSON
  manifests, and SHA-256 sidecars
- Built-in HTTPS certificate bootstrap for non-loopback listeners
- Debian/Ubuntu systemd packaging

## Safety model

The web server never opens a block device itself. Discovery, SMART commands, and
every workload execute in disposable process groups. When a command exceeds its
deadline, Drivarr kills the process group and immediately releases the API/job
goroutine. If the process remains in Linux uninterruptible I/O, Drivarr tracks it
as blocked, quarantines the drive, suppresses automatic access, and refuses to
accumulate replacement workers.

Destructive verification is disabled by default. Starting it requires:

1. An administrator enabling destructive testing.
2. An enabled destructive profile.
3. The operator typing the exact drive serial.
4. Password reauthentication.
5. A fresh isolated check proving the drive and its children are not mounted,
   swap-backed, or held by device-mapper/RAID.

Partitioning uses the same destructive-operation toggle and safeguards, is
restricted to administrators, and creates one full-disk partition. The drive
must expose a serial number so the operator can confirm the exact target.

Drivarr cannot recover a host whose kernel or complete storage bus has frozen.
It prevents a blocked userspace hardware operation from taking down Drivarr or
causing an unlimited retry cascade.

## Development

Requirements: Go 1.24 or newer and Node.js 20 or newer. Hardware tests additionally require
`smartmontools`, `fio`, and `e2fsprogs`.

```sh
npm install
make test
make build
DRIVARR_BOOTSTRAP_PASSWORD='replace-with-a-long-password' make run
```

The web interface is a React application in `cmd/drivarrd/web/src`. `make build`
bundles it with esbuild before embedding the generated JavaScript in the daemon.

`make build` creates the daemon at `build/drivarrd` and the local administration
CLI at `build/drivarrctl`.

## Command-line administration

List physical drives without opening or probing them:

```sh
sudo drivarrctl drives
sudo drivarrctl drives --json
```

Stop the service before changing accounts so the daemon and CLI do not write the
state file concurrently. Passwords must contain at least 12 characters. Passing
them through standard input or a root-readable file avoids exposing them in the
process list:

```sh
sudo systemctl stop drivarr
printf '%s\n' 'new-user-long-password' | sudo drivarrctl users create \
  --username operator1 --role operator --password-stdin
sudo drivarrctl users reset-password --username admin \
  --password-file /root/drivarr-admin-password
sudo systemctl start drivarr
```

Valid roles are `admin`, `operator`, and `viewer`. User commands operate on
`/var/lib/drivarr` by default; use `--data-dir` for a development installation.

Open <http://127.0.0.1:8787>. Development HTTP binds to localhost. A listener on
another interface automatically receives a locally generated HTTPS certificate
unless explicit `--tls-cert` and `--tls-key` paths are provided.

The API contract is served at `/openapi.yaml`.

## Debian/Ubuntu

On a Debian-family build host:

```sh
make package VERSION=0.1.0
sudo apt install ./build/drivarr_0.1.0_*.deb
```

Read the initial password with `journalctl -u drivarr`, then sign in as `admin`
and change it. Local recovery is available without the web service. The legacy
daemon command remains supported, though `drivarrctl users reset-password` is
preferred:

```sh
sudo systemctl stop drivarr
sudo drivarrd account-reset --username admin --password 'new-long-password'
sudo systemctl start drivarr
```

Persistent data and reports remain in `/var/lib/drivarr` when the package is
removed.
