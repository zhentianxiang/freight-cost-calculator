package main

import (
	"flag"
	"log"

	"excelutil/internal/httpapi"
	"excelutil/internal/runner"
)

func main() {
	mode := flag.String("mode", "server", "Run mode: server or cli")
	flag.Parse()

	if *mode == "server" {
		if err := httpapi.Start(":8081", "./data"); err != nil {
			log.Fatal(err)
		}
		return
	}

	runner.RunExport(runner.ExportOptions{
		OutputPath: "output.xlsx",
		Mode:       "internal",
		Lang:       "zh",
	})
}
