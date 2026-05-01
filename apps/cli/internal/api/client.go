package api

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultAPIPath = "/api"

type Client struct {
	baseURL    string
	apiPath    string
	discovered bool
	token      string
	insecure   bool
	httpClient *http.Client
}

type ErrorType string

const (
	ErrorTypeAuthRequired      ErrorType = "auth_required"
	ErrorTypeConnectionRefused ErrorType = "connection_refused"
	ErrorTypeNetworkError      ErrorType = "network_error"
	ErrorTypeServerError       ErrorType = "server_error"
	ErrorTypeTLSError          ErrorType = "tls_error"
	ErrorTypeUnknown           ErrorType = "unknown"
)

type APIError struct {
	Type    ErrorType
	Message string
	Status  int
}

func (e *APIError) Error() string {
	return e.Message
}

func New(baseURL string, token string, insecure bool) *Client {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: insecure,
		},
	}

	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		apiPath:  defaultAPIPath,
		token:    token,
		insecure: insecure,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   30 * time.Second,
		},
	}
}

func (c *Client) SetToken(token string) {
	c.token = token
}

func normalizeAPIPath(path string) string {
	if path == "" || path == "/" {
		return defaultAPIPath
	}
	path = "/" + strings.Trim(path, "/")
	return path
}

func joinPath(prefix, path string) string {
	prefix = strings.TrimRight(prefix, "/")
	path = "/" + strings.TrimLeft(path, "/")
	if prefix == "" {
		return path
	}
	return prefix + path
}

func (c *Client) Discover() error {
	if c.discovered {
		return nil
	}

	resp, err := c.doRequest("GET", "/.well-known/buntime", nil, "")
	if err != nil {
		c.discovered = true
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var config struct {
			API string `json:"api"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&config); err == nil && config.API != "" {
			c.apiPath = normalizeAPIPath(config.API)
		}
	}

	c.discovered = true
	return nil
}

func isStateChangingMethod(method string) bool {
	switch method {
	case "DELETE", "PATCH", "POST", "PUT":
		return true
	default:
		return false
	}
}

func (c *Client) doRequest(method, path string, body io.Reader, contentType string) (*http.Response, error) {
	url := c.baseURL + path

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}

	// Use API key for authentication (bypasses CSRF and other auth)
	if c.token != "" {
		req.Header.Set("X-API-Key", c.token)
	}

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	if isStateChangingMethod(method) {
		req.Header.Set("Origin", c.baseURL)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, c.classifyError(err)
	}

	return resp, nil
}

func (c *Client) doAPIRequest(method, path string, body io.Reader, contentType string) (*http.Response, error) {
	if err := c.Discover(); err != nil {
		return nil, err
	}
	return c.doRequest(method, joinPath(c.apiPath, path), body, contentType)
}

func (c *Client) classifyError(err error) *APIError {
	errStr := err.Error()

	// Check for TLS errors
	if containsAny(errStr, "certificate", "x509", "tls") {
		return &APIError{
			Type:    ErrorTypeTLSError,
			Message: "TLS certificate error. Use --insecure (-k) to skip verification.",
		}
	}

	// Check for connection refused
	if containsAny(errStr, "connection refused", "ECONNREFUSED", "no such host") {
		return &APIError{
			Type:    ErrorTypeConnectionRefused,
			Message: "Connection refused. Is the server running?",
		}
	}

	// Network error
	if containsAny(errStr, "timeout", "network", "dial") {
		return &APIError{
			Type:    ErrorTypeNetworkError,
			Message: "Network error: " + err.Error(),
		}
	}

	return &APIError{
		Type:    ErrorTypeUnknown,
		Message: err.Error(),
	}
}

func containsAny(s string, substrs ...string) bool {
	for _, substr := range substrs {
		if len(s) >= len(substr) {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
		}
	}
	return false
}

func (c *Client) handleResponse(resp *http.Response, v interface{}) error {
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return &APIError{
			Type:    ErrorTypeAuthRequired,
			Message: "Authentication required",
			Status:  401,
		}
	}

	if resp.StatusCode >= 500 {
		body, _ := io.ReadAll(resp.Body)
		return &APIError{
			Type:    ErrorTypeServerError,
			Message: fmt.Sprintf("Server error (%d): %s", resp.StatusCode, string(body)),
			Status:  resp.StatusCode,
		}
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return &APIError{
			Type:    ErrorTypeUnknown,
			Message: fmt.Sprintf("Request failed (%d): %s", resp.StatusCode, string(body)),
			Status:  resp.StatusCode,
		}
	}

	if v != nil {
		return json.NewDecoder(resp.Body).Decode(v)
	}

	return nil
}

// Health API

type HealthInfo struct {
	OK      bool   `json:"ok"`
	Status  string `json:"status"`
	Version string `json:"version"`
}

func (c *Client) GetHealth() (*HealthInfo, error) {
	resp, err := c.doAPIRequest("GET", "/health", nil, "")
	if err != nil {
		return nil, err
	}

	var health HealthInfo
	if err := c.handleResponse(resp, &health); err != nil {
		return nil, err
	}

	return &health, nil
}

// Ping checks if server is reachable and if auth is required
// Calls a protected endpoint to verify both connectivity and authentication
func (c *Client) Ping() error {
	// Call a protected endpoint to check auth status
	resp, err := c.doAPIRequest("GET", "/plugins", nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 401 means server is up but needs authentication
	if resp.StatusCode == 401 {
		return &APIError{
			Type:    ErrorTypeAuthRequired,
			Message: "Authentication required",
			Status:  401,
		}
	}

	// 403 might mean auth required (no key) or permission denied (invalid key)
	// Check the response body for the error code
	if resp.StatusCode == 403 {
		var errResp struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil {
			if errResp.Code == "AUTH_REQUIRED" {
				return &APIError{
					Type:    ErrorTypeAuthRequired,
					Message: "Authentication required",
					Status:  403,
				}
			}
		}
		return &APIError{
			Type:    ErrorTypeAuthRequired,
			Message: "Authentication required",
			Status:  403,
		}
	}

	// 200 means authenticated successfully
	return nil
}

// IsReachable checks if the server is reachable (any HTTP response = reachable)
func (c *Client) IsReachable() bool {
	resp, err := c.doAPIRequest("GET", "/health", nil, "")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	// Any HTTP response means the server is reachable
	return true
}

// Plugins API

type PluginInfo struct {
	ID       int      `json:"id"`
	Name     string   `json:"name"`
	Base     string   `json:"base,omitempty"`
	Enabled  bool     `json:"enabled"`
	Path     string   `json:"path"`
	Versions []string `json:"versions"`
}

func (c *Client) ListPlugins() ([]PluginInfo, error) {
	resp, err := c.doAPIRequest("GET", "/plugins", nil, "")
	if err != nil {
		return nil, err
	}

	var plugins []PluginInfo
	if err := c.handleResponse(resp, &plugins); err != nil {
		return nil, err
	}

	for i := range plugins {
		if plugins[i].Path != "" {
			plugins[i].Enabled = true
		}
		if len(plugins[i].Versions) == 0 {
			plugins[i].Versions = []string{"latest"}
		}
	}

	return plugins, nil
}

func (c *Client) EnablePlugin(id int) error {
	if id == 0 {
		return fmt.Errorf("plugin enable is not supported by this runtime API")
	}
	resp, err := c.doAPIRequest("PUT", fmt.Sprintf("/plugins/%d/enable", id), nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

func (c *Client) DisablePlugin(id int) error {
	if id == 0 {
		return fmt.Errorf("plugin disable is not supported by this runtime API")
	}
	resp, err := c.doAPIRequest("PUT", fmt.Sprintf("/plugins/%d/disable", id), nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

func (c *Client) RemovePlugin(id int) error {
	if id == 0 {
		return fmt.Errorf("plugin removal by numeric ID is not supported by this runtime API")
	}
	resp, err := c.doAPIRequest("DELETE", fmt.Sprintf("/plugins/%d", id), nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

func (c *Client) RemovePluginByName(name string) error {
	resp, err := c.doAPIRequest("DELETE", "/plugins/"+url.PathEscape(name), nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

type InstallResult struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Version string `json:"version"`
}

func (c *Client) InstallPlugin(filePath string) (*InstallResult, error) {
	result, err := c.uploadAPIFile("/plugins/upload", filePath)
	if err != nil {
		return nil, err
	}
	if err := c.ReloadPlugins(); err != nil {
		return nil, err
	}
	return result, nil
}

func (c *Client) ReloadPlugins() error {
	resp, err := c.doAPIRequest("POST", "/plugins/reload", nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

// Apps API

type AppInfo struct {
	Name     string   `json:"name"`
	Path     string   `json:"path"`
	Versions []string `json:"versions"`
}

func (c *Client) ListApps() ([]AppInfo, error) {
	resp, err := c.doAPIRequest("GET", "/apps", nil, "")
	if err != nil {
		return nil, err
	}

	var apps []AppInfo
	if err := c.handleResponse(resp, &apps); err != nil {
		return nil, err
	}

	return apps, nil
}

func (c *Client) RemoveApp(name, version string) error {
	scope, pkgName := parsePackageName(name)
	path := "/apps/" + scope + "/" + pkgName + "/" + version
	resp, err := c.doAPIRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

// parsePackageName splits a package name into scope and name
// "@scope/name" -> ("@scope", "name")
// "name" -> ("_", "name")
func parsePackageName(fullName string) (scope, name string) {
	if len(fullName) > 0 && fullName[0] == '@' {
		// Scoped package: @scope/name
		parts := strings.SplitN(fullName, "/", 2)
		if len(parts) == 2 {
			return parts[0], parts[1]
		}
	}
	// Unscoped package: use "_" as placeholder
	return "_", fullName
}

func (c *Client) InstallApp(filePath string) (*InstallResult, error) {
	return c.uploadAPIFile("/apps/upload", filePath)
}

// Keys API

type KeyRole string

const (
	KeyRoleAdmin  KeyRole = "admin"
	KeyRoleEditor KeyRole = "editor"
	KeyRoleViewer KeyRole = "viewer"
	KeyRoleCustom KeyRole = "custom"
)

type Permission string

const (
	PermAppsRead       Permission = "apps:read"
	PermAppsInstall    Permission = "apps:install"
	PermAppsRemove     Permission = "apps:remove"
	PermPluginsRead    Permission = "plugins:read"
	PermPluginsInstall Permission = "plugins:install"
	PermPluginsRemove  Permission = "plugins:remove"
	PermPluginsConfig  Permission = "plugins:config"
	PermKeysRead       Permission = "keys:read"
	PermKeysCreate     Permission = "keys:create"
	PermKeysRevoke     Permission = "keys:revoke"
	PermWorkersRead    Permission = "workers:read"
	PermWorkersRestart Permission = "workers:restart"
)

type ApiKeyInfo struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	KeyPrefix   string       `json:"keyPrefix"`
	Role        KeyRole      `json:"role"`
	Permissions []Permission `json:"permissions"`
	CreatedAt   int64        `json:"createdAt"`
	CreatedBy   *int         `json:"createdBy"`
	ExpiresAt   *int64       `json:"expiresAt"`
	LastUsedAt  *int64       `json:"lastUsedAt"`
	Description *string      `json:"description"`
}

type KeyMetaInfo struct {
	Roles       []KeyRole    `json:"roles"`
	Permissions []Permission `json:"permissions"`
}

type CreateKeyInput struct {
	Name        string       `json:"name"`
	Role        KeyRole      `json:"role"`
	ExpiresIn   string       `json:"expiresIn,omitempty"`
	Description string       `json:"description,omitempty"`
	Permissions []Permission `json:"permissions,omitempty"`
}

type CreateKeyResult struct {
	ID        int     `json:"id"`
	Name      string  `json:"name"`
	Key       string  `json:"key"`
	KeyPrefix string  `json:"keyPrefix"`
	Role      KeyRole `json:"role"`
}

func (c *Client) ListKeys() ([]ApiKeyInfo, error) {
	resp, err := c.doAPIRequest("GET", "/keys", nil, "")
	if err != nil {
		return nil, err
	}

	var result struct {
		Keys []ApiKeyInfo `json:"keys"`
	}
	if err := c.handleResponse(resp, &result); err != nil {
		return nil, err
	}

	return result.Keys, nil
}

func (c *Client) GetKeyMeta() (*KeyMetaInfo, error) {
	resp, err := c.doAPIRequest("GET", "/keys/meta", nil, "")
	if err != nil {
		return nil, err
	}

	var meta KeyMetaInfo
	if err := c.handleResponse(resp, &meta); err != nil {
		return nil, err
	}

	return &meta, nil
}

func (c *Client) CreateKey(input CreateKeyInput) (*CreateKeyResult, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	resp, err := c.doAPIRequest("POST", "/keys", bytes.NewReader(body), "application/json")
	if err != nil {
		return nil, err
	}

	var result struct {
		Success bool            `json:"success"`
		Data    CreateKeyResult `json:"data"`
	}
	if err := c.handleResponse(resp, &result); err != nil {
		return nil, err
	}

	return &result.Data, nil
}

func (c *Client) RevokeKey(id int) error {
	resp, err := c.doAPIRequest("DELETE", fmt.Sprintf("/keys/%d", id), nil, "")
	if err != nil {
		return err
	}
	return c.handleResponse(resp, nil)
}

// File upload helper
func (c *Client) uploadAPIFile(endpoint, filePath string) (*InstallResult, error) {
	if err := c.Discover(); err != nil {
		return nil, err
	}
	return c.uploadFile(joinPath(c.apiPath, endpoint), filePath)
}

func (c *Client) uploadFile(endpoint, filePath string) (*InstallResult, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return nil, fmt.Errorf("failed to copy file: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close writer: %w", err)
	}

	resp, err := c.doRequest("POST", endpoint, body, writer.FormDataContentType())
	if err != nil {
		return nil, err
	}

	var raw json.RawMessage
	if err := c.handleResponse(resp, &raw); err != nil {
		return nil, err
	}

	result, err := parseInstallResult(raw)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func parseInstallResult(raw json.RawMessage) (*InstallResult, error) {
	var flat InstallResult
	if err := json.Unmarshal(raw, &flat); err == nil && flat.Name != "" {
		return &flat, nil
	}

	var wrapped struct {
		Data struct {
			App struct {
				InstalledAt string `json:"installedAt"`
				Name        string `json:"name"`
				Version     string `json:"version"`
			} `json:"app"`
			Plugin struct {
				InstalledAt string `json:"installedAt"`
				Name        string `json:"name"`
				Version     string `json:"version"`
			} `json:"plugin"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, err
	}

	if wrapped.Data.App.Name != "" {
		return &InstallResult{
			Name:    wrapped.Data.App.Name,
			Path:    wrapped.Data.App.InstalledAt,
			Version: wrapped.Data.App.Version,
		}, nil
	}
	if wrapped.Data.Plugin.Name != "" {
		return &InstallResult{
			Name:    wrapped.Data.Plugin.Name,
			Path:    wrapped.Data.Plugin.InstalledAt,
			Version: wrapped.Data.Plugin.Version,
		}, nil
	}

	return nil, fmt.Errorf("unexpected install response: %s", string(raw))
}
