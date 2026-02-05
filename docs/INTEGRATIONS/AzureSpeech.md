# Azure Speech Integration (Scaffold)

## Overview
This project is preparing to use Azure Speech for server-side STT. This document
defines the required environment variables and basic setup steps. Runtime
integration is not wired yet.

## Required Azure resources
- Speech resource (Azure Speech Services) in your subscription.

## Environment variables
Set these in your server environment or `.env` file (never commit secrets):
- `AZURE_SPEECH_KEY`: API key for the Speech resource.
- `AZURE_SPEECH_REGION`: Azure region for the Speech resource, e.g. `eastus`.
- `AZURE_SPEECH_ENDPOINT`: Optional custom endpoint, if required by your resource.
- `AZURE_SPEECH_RECOGNITION_LANGUAGE`: Optional locale, e.g. `en-US`.
- `AZURE_SPEECH_DIARIZATION`: Optional `true|false` (default false) to enable speaker labels if supported by the SDK.
- `AZURE_SPEECH_SAMPLE_RATE_HZ`: Optional target sample rate for Azure ingestion (default 16000).
- `STT_PROVIDER`: Optional `azure|openai` (default `azure`) to select the STT provider.

## Setup steps
1. Create a Speech resource in the Azure Portal.
2. Copy the key and region from the resource overview.
3. Set the environment variables in your local `.env` and deployment secrets.

## Optional Azure CLI flow
If you prefer CLI:
1. `az login`
2. `az account set --subscription <your-subscription-id>`
3. Use the Azure Portal to retrieve keys or `az cognitiveservices account keys list`.

