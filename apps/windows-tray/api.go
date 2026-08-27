package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const apiVersion = "1.0.0"

type apiClient struct {
	baseURL string
	token   string
	http    *http.Client
}

type profile struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

type snapshot struct {
	Revision int      `json:"revision"`
	Profile  snapProf `json:"profile"`
	Playback playback `json:"playback"`
}

type snapProf struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Settings    struct {
		Playback struct {
			SkipBackwardSeconds float64 `json:"skipBackwardSeconds"`
			SkipForwardSeconds  float64 `json:"skipForwardSeconds"`
		} `json:"playback"`
	} `json:"settings"`
}

type playback struct {
	State          string   `json:"state"`
	PositionMs     float64  `json:"positionMs"`
	DurationMs     float64  `json:"durationMs"`
	ActiveDeviceID string   `json:"activeDeviceId"`
	Episode        *episode `json:"episode"`
}

type episode struct {
	Title        string `json:"title"`
	PodcastTitle string `json:"podcastTitle"`
}

func newAPIClient(serverURL, token string) *apiClient {
	return &apiClient{
		baseURL: strings.TrimRight(strings.TrimSpace(serverURL), "/"),
		token:   token,
		http:    &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *apiClient) request(method, path string, payload any, out any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, c.baseURL+"/api/v1"+path, body)
	if err != nil {
		return fmt.Errorf("invalid server URL: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach Podwaffle: %w", err)
	}
	defer res.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if readErr != nil {
		return readErr
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var apiErr struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(responseBody, &apiErr)
		if apiErr.Error.Message != "" {
			return fmt.Errorf("%s", apiErr.Error.Message)
		}
		return fmt.Errorf("Podwaffle returned HTTP %d", res.StatusCode)
	}
	if out != nil && len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, out); err != nil {
			return fmt.Errorf("invalid Podwaffle response: %w", err)
		}
	}
	return nil
}

func (c *apiClient) listProfiles() ([]profile, error) {
	var result struct {
		Profiles []profile `json:"profiles"`
	}
	err := c.request(http.MethodGet, "/join/profiles", nil, &result)
	return result.Profiles, err
}

func (c *apiClient) join(profileID, joinCode string) (string, error) {
	var result struct {
		Token string `json:"token"`
	}
	err := c.request(http.MethodPost, "/join", map[string]any{
		"profileId":      profileID,
		"joinCode":       joinCode,
		"deviceName":     "Podwaffle Windows tray",
		"platform":       "home_assistant",
		"appVersion":     apiVersion,
		"runtimeVersion": "windows",
	}, &result)
	if err != nil {
		return "", err
	}
	if result.Token == "" {
		return "", fmt.Errorf("Podwaffle did not return a device token")
	}
	return result.Token, nil
}

func (c *apiClient) getSnapshot() (snapshot, error) {
	var result snapshot
	err := c.request(http.MethodGet, "/snapshot", nil, &result)
	return result, err
}

func (c *apiClient) command(action string, parameters map[string]any) error {
	commandID, err := newUUID()
	if err != nil {
		return err
	}
	payload := map[string]any{"commandId": commandID, "action": action}
	for key, value := range parameters {
		payload[key] = value
	}
	var result struct {
		Status    string `json:"status"`
		Delivered bool   `json:"delivered"`
	}
	if err := c.request(http.MethodPost, "/playback/commands", payload, &result); err != nil {
		return err
	}
	if result.Status == "pending" && !result.Delivered {
		return fmt.Errorf("the active Podwaffle player is not connected")
	}
	if result.Status != "pending" {
		return nil
	}
	for attempt := 0; attempt < 20; attempt++ {
		time.Sleep(250 * time.Millisecond)
		var status struct {
			Status string `json:"status"`
			Result struct {
				Message string `json:"message"`
			} `json:"result"`
		}
		if err := c.request(http.MethodGet, "/playback/commands/"+commandID, nil, &status); err != nil {
			return err
		}
		switch status.Status {
		case "accepted":
			return nil
		case "rejected", "cancelled":
			if status.Result.Message != "" {
				return fmt.Errorf("%s", status.Result.Message)
			}
			return fmt.Errorf("the active Podwaffle player rejected the command")
		}
	}
	return nil
}

func newUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(value[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexValue[0:8], hexValue[8:12], hexValue[12:16], hexValue[16:20], hexValue[20:32]), nil
}
