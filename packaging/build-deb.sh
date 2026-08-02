#!/bin/sh
set -eu

version="${1:?version required}"
binary="${2:?binary path required}"
cli_binary="${3:?CLI binary path required}"
arch="$(dpkg --print-architecture)"
root="build/deb-root"
package="build/drivarr_${version}_${arch}.deb"

rm -rf "$root"
install -D -m 0755 "$binary" "$root/usr/bin/drivarrd"
install -D -m 0755 "$cli_binary" "$root/usr/bin/drivarrctl"
install -D -m 0644 packaging/drivarr.service "$root/lib/systemd/system/drivarr.service"
install -D -m 0644 packaging/drivarr.default "$root/etc/default/drivarr"
install -d -m 0750 "$root/var/lib/drivarr"
install -d -m 0755 "$root/DEBIAN"

sed "s/@VERSION@/$version/g; s/@ARCH@/$arch/g" packaging/control.in > "$root/DEBIAN/control"
install -m 0755 packaging/postinst "$root/DEBIAN/postinst"
install -m 0755 packaging/prerm "$root/DEBIAN/prerm"
dpkg-deb --root-owner-group --build "$root" "$package"
echo "$package"
