@echo off
rem Starts the two local pieces needed by the Figma "Talk To Figma MCP Plugin":
rem   1. the WebSocket socket server on port 3055 (required by the MCP server)
rem   2. a tiny relay on port 3054 -> 3055, for when the plugin's port field says 3054
rem Keep both windows open while using Figma.

setlocal
set HERE=%~dp0

start "figma socket server (3055)" cmd /k "bunx cursor-talk-to-figma-socket@latest"
timeout /t 4 /nobreak >nul
start "figma relay (3054 -> 3055)" cmd /k "node "%HERE%scripts\figma-ws-relay.mjs""

echo Socket server and relay started.
echo In Figma: open the plugin, keep port 3054, click Connect.
echo In Cursor: enable the TalkToFigma MCP server, then ask the AI to join the channel shown in the plugin.
timeout /t 5 /nobreak >nul
