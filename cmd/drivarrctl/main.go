package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"drivarr/internal/core"
	"drivarr/internal/drives"
)

var discoverDrives = drives.Discover

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "drivarrctl:", err)
		os.Exit(1)
	}
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		printUsage(stderr)
		return errors.New("command required")
	}
	switch args[0] {
	case "help", "-h", "--help":
		printUsage(stdout)
		return nil
	case "drives":
		return runDrives(args[1:], stdout, stderr)
	case "users":
		return runUsers(args[1:], stdin, stdout, stderr)
	default:
		printUsage(stderr)
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func printUsage(output io.Writer) {
	fmt.Fprintln(output, `Usage:
  drivarrctl drives [--json]
  drivarrctl users create --username NAME --role ROLE [password option]
  drivarrctl users reset-password --username NAME [password option]

Password options (choose one):
  --password VALUE       Read the password from the command line
  --password-file PATH   Read the password from a file
  --password-stdin       Read the password from standard input

User commands default to --data-dir /var/lib/drivarr. Stop the drivarr service
before changing users in its data directory.`)
}

func runDrives(args []string, output, stderr io.Writer) error {
	flags := flag.NewFlagSet("drives", flag.ContinueOnError)
	flags.SetOutput(stderr)
	asJSON := flags.Bool("json", false, "emit JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("drives does not accept positional arguments")
	}
	devices, err := discoverDrives()
	if err != nil {
		return fmt.Errorf("discover drives: %w", err)
	}
	if *asJSON {
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		return encoder.Encode(devices)
	}
	table := tabwriter.NewWriter(output, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(table, "NAME\tPATH"); err != nil {
		return err
	}
	for _, device := range devices {
		if _, err := fmt.Fprintf(table, "%s\t%s\n", device.Name, device.Path); err != nil {
			return err
		}
	}
	return table.Flush()
}

func runUsers(args []string, stdin io.Reader, output, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New("users command required (create or reset-password)")
	}
	switch args[0] {
	case "create":
		return runUserCreate(args[1:], stdin, output, stderr)
	case "reset-password":
		return runUserReset(args[1:], stdin, output, stderr)
	case "help", "-h", "--help":
		printUsage(output)
		return nil
	default:
		return fmt.Errorf("unknown users command %q", args[0])
	}
}

type passwordFlags struct {
	value    string
	file     string
	useStdin bool
}

func addPasswordFlags(flags *flag.FlagSet) *passwordFlags {
	options := &passwordFlags{}
	flags.StringVar(&options.value, "password", "", "password value")
	flags.StringVar(&options.file, "password-file", "", "file containing the password")
	flags.BoolVar(&options.useStdin, "password-stdin", false, "read password from standard input")
	return options
}

func (options passwordFlags) read(input io.Reader) (string, error) {
	sources := 0
	if options.value != "" {
		sources++
	}
	if options.file != "" {
		sources++
	}
	if options.useStdin {
		sources++
	}
	if sources != 1 {
		return "", errors.New("exactly one password option is required")
	}
	if options.value != "" {
		return options.value, nil
	}
	var raw []byte
	var err error
	if options.file != "" {
		raw, err = os.ReadFile(options.file)
	} else {
		raw, err = io.ReadAll(io.LimitReader(input, 1024*1024))
	}
	if err != nil {
		return "", fmt.Errorf("read password: %w", err)
	}
	password := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
	if password == "" {
		return "", errors.New("password is empty")
	}
	return password, nil
}

func runUserCreate(args []string, stdin io.Reader, output, stderr io.Writer) error {
	flags := flag.NewFlagSet("users create", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dataDir := flags.String("data-dir", "/var/lib/drivarr", "persistent data directory")
	username := flags.String("username", "", "local username")
	role := flags.String("role", string(core.RoleViewer), "admin, operator, or viewer")
	passwordOptions := addPasswordFlags(flags)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("users create does not accept positional arguments")
	}
	if strings.TrimSpace(*username) == "" {
		return errors.New("--username is required")
	}
	password, err := passwordOptions.read(stdin)
	if err != nil {
		return err
	}
	store, err := core.OpenStore(*dataDir)
	if err != nil {
		return fmt.Errorf("open data store: %w", err)
	}
	user, err := store.CreateUser(*username, password, core.Role(*role))
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	store.Audit("", "user.create_cli", user.ID, "", map[string]any{"role": user.Role})
	_, err = fmt.Fprintf(output, "created user %s (%s)\n", user.Username, user.Role)
	return err
}

func runUserReset(args []string, stdin io.Reader, output, stderr io.Writer) error {
	flags := flag.NewFlagSet("users reset-password", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dataDir := flags.String("data-dir", "/var/lib/drivarr", "persistent data directory")
	username := flags.String("username", "admin", "local username")
	passwordOptions := addPasswordFlags(flags)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("users reset-password does not accept positional arguments")
	}
	password, err := passwordOptions.read(stdin)
	if err != nil {
		return err
	}
	store, err := core.OpenStore(*dataDir)
	if err != nil {
		return fmt.Errorf("open data store: %w", err)
	}
	if err := store.ResetPassword(*username, password); err != nil {
		return fmt.Errorf("reset password: %w", err)
	}
	_, err = fmt.Fprintf(output, "reset password for user %s\n", strings.ToLower(strings.TrimSpace(*username)))
	return err
}
