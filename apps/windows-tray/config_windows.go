//go:build windows

package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

type savedConfig struct {
	ServerURL      string `json:"serverUrl"`
	ProfileID      string `json:"profileId"`
	ProfileName    string `json:"profileName"`
	ProtectedToken string `json:"protectedToken,omitempty"`
}

type dataBlob struct {
	Size uint32
	Data *byte
}

var (
	crypt32        = syscall.NewLazyDLL("Crypt32.dll")
	kernel32       = syscall.NewLazyDLL("Kernel32.dll")
	cryptProtect   = crypt32.NewProc("CryptProtectData")
	cryptUnprotect = crypt32.NewProc("CryptUnprotectData")
	localFree      = kernel32.NewProc("LocalFree")
)

func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Podwaffle", "windows-tray.json"), nil
}

func loadConfig() (savedConfig, string, string, error) {
	path, err := configPath()
	if err != nil {
		return savedConfig{}, "", "", err
	}
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return savedConfig{}, path, "", nil
	}
	if err != nil {
		return savedConfig{}, path, "", err
	}
	var config savedConfig
	if err := json.Unmarshal(content, &config); err != nil {
		return savedConfig{}, path, "", fmt.Errorf("invalid saved configuration: %w", err)
	}
	if config.ProtectedToken == "" {
		return config, path, "", nil
	}
	decoded, err := base64.StdEncoding.DecodeString(config.ProtectedToken)
	if err != nil {
		return savedConfig{}, path, "", fmt.Errorf("invalid saved token: %w", err)
	}
	token, err := unprotect(decoded)
	if err != nil {
		return savedConfig{}, path, "", fmt.Errorf("could not unlock saved token: %w", err)
	}
	return config, path, string(token), nil
}

func saveConfig(path string, config savedConfig, token string) error {
	protected, err := protect([]byte(token))
	if err != nil {
		return err
	}
	config.ProtectedToken = base64.StdEncoding.EncodeToString(protected)
	content, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, content, 0600)
}

func protect(value []byte) ([]byte, error) {
	input := dataBlob{Size: uint32(len(value))}
	if len(value) > 0 {
		input.Data = &value[0]
	}
	var output dataBlob
	result, _, callErr := cryptProtect.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0, 0, uintptr(unsafe.Pointer(&output)))
	if result == 0 {
		return nil, callErr
	}
	defer localFree.Call(uintptr(unsafe.Pointer(output.Data)))
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil
}

func unprotect(value []byte) ([]byte, error) {
	input := dataBlob{Size: uint32(len(value))}
	if len(value) > 0 {
		input.Data = &value[0]
	}
	var output dataBlob
	result, _, callErr := cryptUnprotect.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0, 0, uintptr(unsafe.Pointer(&output)))
	if result == 0 {
		return nil, callErr
	}
	defer localFree.Call(uintptr(unsafe.Pointer(output.Data)))
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil
}
