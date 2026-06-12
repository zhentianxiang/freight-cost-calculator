package main

import (
	"log"

	"excelutil/internal/httpapi"
)

func main() {
	if err := httpapi.Start(":8081", "./data"); err != nil {
		log.Fatal(err)
	}
}
