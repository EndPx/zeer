// Native HTTP workload runner. No retries, writes to the service, or private keys.
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Header struct {
	Height   uint64 `json:"height"`
	Hash     string `json:"hash"`
	Previous string `json:"previous_hash"`
	Time     uint64 `json:"time"`
}
type Tx struct {
	ID       string `json:"txid"`
	Height   uint64 `json:"block_height"`
	Index    uint64 `json:"index"`
	Version  int    `json:"version"`
	Locktime uint64 `json:"locktime"`
	Raw      string `json:"raw"`
}
type Oracle struct {
	Start   uint64          `json:"start"`
	End     uint64          `json:"end"`
	Headers []Header        `json:"headers"`
	Txs     map[string][]Tx `json:"transactions"`
}
type Response struct {
	Network  string   `json:"network"`
	Epoch    string   `json:"epoch"`
	Revision string   `json:"revision"`
	From     uint64   `json:"from_block"`
	To       uint64   `json:"to_block"`
	Next     uint64   `json:"next_block"`
	Cursor   *string  `json:"cursor"`
	Complete bool     `json:"complete"`
	Txs      []Tx     `json:"transactions"`
	Missing  []string `json:"missing_txids"`
	Data     struct {
		Blocks []Header `json:"blocks"`
		Txs    []Tx     `json:"transactions"`
	} `json:"data"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}
type Sample struct {
	ID       uint64  `json:"id"`
	Started  int64   `json:"started_ns"`
	Seconds  float64 `json:"seconds"`
	Status   int     `json:"status"`
	Outcome  string  `json:"outcome"`
	Bytes    int     `json:"bytes"`
	Rows     int     `json:"rows"`
	Revision string  `json:"revision,omitempty"`
}

func main() {
	endpoint := flag.String("endpoint", "http://127.0.0.1:39481", "Loopback Prep endpoint")
	oraclePath := flag.String("oracle", "", "Untimed source oracle")
	output := flag.String("out", "", "New output prefix")
	scenario := flag.String("case", "headers1000", "headers1000, txid, raw_shielded")
	clients := flag.Int("clients", 1, "Concurrent clients")
	seconds := flag.Int("seconds", 30, "Measurement window")
	flag.Parse()
	u, err := url.Parse(*endpoint)
	if err != nil || u.Scheme != "http" || u.User != nil || !net.ParseIP(u.Hostname()).IsLoopback() {
		panic("loopback HTTP required")
	}
	if *clients < 1 || *clients > 128 || *seconds < 1 || *seconds > 60 || *output == "" {
		panic("invalid bounded workload")
	}
	var o Oracle
	data, err := os.ReadFile(*oraclePath)
	if err != nil {
		panic(err)
	}
	if json.Unmarshal(data, &o) != nil || o.End < o.Start || len(o.Headers) != int(o.End-o.Start+1) {
		panic("invalid oracle")
	}
	if *scenario == "headers1000" && len(o.Headers) < 1000 {
		panic("headers1000 requires at least 1000 oracle headers")
	}
	var txs []Tx
	for _, pool := range []string{"sapling", "orchard", "ironwood"} {
		txs = append(txs, o.Txs[pool]...)
	}
	if len(txs) == 0 {
		panic("no shielded transaction samples")
	}
	transport := &http.Transport{MaxIdleConns: 128, MaxIdleConnsPerHost: *clients, MaxConnsPerHost: *clients, DisableCompression: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return fmt.Errorf("redirect refused") }}
	run := func(id uint64) Sample {
		var body any
		path := "/query"
		var selected Tx
		var from, to uint64
		switch *scenario {
		case "headers1000":
			from = o.Start + (id*2654435761+1000)%(o.End-o.Start+2-1000)
			to = from + 1000
			body = map[string]any{"from_block": from, "to_block": to, "limit": 1000, "field_selection": map[string]any{"block": []string{"height", "hash", "previous_hash", "time"}, "transaction": []string{}}}
		case "txid", "raw_shielded":
			path = "/transactions"
			selected = txs[id%uint64(len(txs))]
			from = selected.Height
			to = from + 1
			fields := []string{"txid", "block_height", "index", "version", "locktime"}
			if *scenario == "raw_shielded" {
				fields = append(fields, "raw")
			}
			body = map[string]any{"from_block": from, "to_block": to, "txids": []string{selected.ID}, "fields": fields}
		default:
			panic("unknown case")
		}
		encoded, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", *endpoint+path, bytes.NewReader(encoded))
		req.Header.Set("Content-Type", "application/json")
		if token := os.Getenv("PREP_API_TOKEN"); token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		started := time.Now()
		sample := Sample{ID: id, Started: started.UnixNano(), Outcome: "transport_error"}
		res, err := client.Do(req)
		if err != nil {
			sample.Seconds = time.Since(started).Seconds()
			return sample
		}
		sample.Status = res.StatusCode
		raw, readErr := io.ReadAll(io.LimitReader(res.Body, 4*1024*1024+1))
		res.Body.Close()
		sample.Bytes = len(raw)
		var response Response
		decodeErr := json.Unmarshal(raw, &response)
		sample.Seconds = time.Since(started).Seconds()
		sample.Revision = response.Revision
		if readErr != nil || decodeErr != nil || len(raw) > 4*1024*1024 {
			sample.Outcome = "invalid_response"
			return sample
		}
		if res.StatusCode != 200 {
			sample.Outcome = response.Error.Code
			if sample.Outcome == "" {
				sample.Outcome = "unknown_http_error"
			}
			return sample
		}
		// Oracle checking is outside request latency, inside achieved throughput.
		sample.Outcome = "correctness_error"
		if response.Network != "testnet" || response.From != from || response.To != to || response.Epoch != "0" {
			return sample
		}
		if *scenario == "headers1000" {
			if len(response.Data.Blocks) != 1000 || response.Next != to || response.Cursor != nil {
				return sample
			}
			for i, h := range response.Data.Blocks {
				if h != o.Headers[int(from-o.Start)+i] {
					return sample
				}
			}
			sample.Rows = 1000
		} else {
			if !response.Complete || len(response.Missing) != 0 || len(response.Txs) != 1 {
				return sample
			}
			actual := response.Txs[0]
			if *scenario == "txid" {
				selected.Raw = ""
			}
			if actual != selected {
				return sample
			}
			sample.Rows = 1
		}
		sample.Outcome = "verified_200"
		return sample
	}
	for i := uint64(0); i < 8; i++ {
		s := run(i)
		if s.Outcome != "verified_200" {
			panic(fmt.Sprintf("preflight failed: %+v", s))
		}
	}
	file, err := os.OpenFile(*output+".jsonl.gz", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		panic(err)
	}
	zipped := gzip.NewWriter(file)
	encoder := json.NewEncoder(zipped)
	samples := make(chan Sample, 1024)
	var wg sync.WaitGroup
	var next atomic.Uint64
	start := time.Now()
	deadline := start.Add(time.Duration(*seconds) * time.Second)
	for i := 0; i < *clients; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Now().Before(deadline) {
				samples <- run(next.Add(1) - 1)
			}
		}()
	}
	go func() { wg.Wait(); close(samples) }()
	counts := map[string]int{}
	var success []float64
	var attempted int
	var responseBytes, rows int64
	var totalLatency float64
	for s := range samples {
		if err := encoder.Encode(s); err != nil {
			panic(err)
		}
		attempted++
		counts[s.Outcome]++
		responseBytes += int64(s.Bytes)
		rows += int64(s.Rows)
		totalLatency += s.Seconds
		if s.Outcome == "verified_200" {
			success = append(success, s.Seconds)
		}
	}
	elapsed := time.Since(start).Seconds()
	if err := zipped.Close(); err != nil {
		panic(err)
	}
	if err := file.Close(); err != nil {
		panic(err)
	}
	sort.Float64s(success)
	quantile := func(p float64) any {
		if len(success) == 0 {
			return nil
		}
		i := int(float64(len(success)-1) * p)
		return success[i]
	}
	result := map[string]any{"case": *scenario, "clients": *clients, "windowSeconds": *seconds, "elapsedSeconds": elapsed, "attempts": attempted, "outcomes": counts, "successes": len(success), "successRate": float64(len(success)) / float64(attempted), "p50Seconds": quantile(.5), "p95Seconds": quantile(.95), "p99Seconds": quantile(.99), "successfulRowsPerSecond": float64(rows) / elapsed, "responseBytes": responseBytes, "allAttemptMeanSeconds": totalLatency / float64(attempted), "timing": "request dispatch through full response and JSON decode; correctness outside request latency, inside throughput"}
	report, _ := json.MarshalIndent(result, "", "  ")
	if err := os.WriteFile(*output+".json", report, 0600); err != nil {
		panic(err)
	}
	fmt.Println(string(report))
	for outcome := range counts {
		if outcome != "verified_200" && !strings.Contains(outcome, "CAPACITY") && outcome != "SOURCE_NOT_READY" {
			os.Exit(2)
		}
	}
	if len(success) == 0 {
		os.Exit(3)
	}
}
