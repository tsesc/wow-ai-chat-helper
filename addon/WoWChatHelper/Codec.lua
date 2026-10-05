-- Adapted from wow-ai (MIT) by chelinho139: addon/WoWAI/Codec.lua
--
-- WoWChatHelper pixel codec. Pure Lua 5.1, no WoW APIs, so it can be tested
-- outside the game (tests/codec_test.js decodes its output with bridge/protocol.js).
--
-- A frame is a byte stream:
--   [0xC7 0x2B] [id hi, id lo] [len hi, len lo] [payload: len bytes] [fletcher s1, s2]
-- The magic differs from wow-ai's (0xC7 0x1A) so the two bridges never read each
-- other's strip. The checksum covers id..payload. The bytes are packed MSB-first
-- into 3-bit cells; each cell is drawn as one square whose R, G and B channels are
-- each fully on or off (bit 2 = R, bit 1 = G, bit 0 = B). Pure primaries survive
-- any gamma/contrast setting, unlike intermediate levels.
--
-- The payload is one or more records (spec 3.1); building them is Transport's job.

WCH_Codec = {}
local C = WCH_Codec

local _, ns = ...
if type(ns) == "table" then ns.Codec = C end

C.MAGIC1, C.MAGIC2 = 0xC7, 0x2B
C.BITS = 3
C.CELL = 4            -- pixels per cell side
C.CELLS_PER_ROW = 200
C.MAX_ROWS = 48
C.MAX_PAYLOAD = 3200  -- hard codec limit; the addon batches records into <= 3000 bytes

function C.Fletcher16(bytes, from, to)
	local s1, s2 = 0, 0
	for i = from, to do
		s1 = (s1 + bytes[i]) % 255
		s2 = (s2 + s1) % 255
	end
	return s1, s2
end

-- Returns an array of cell values (0..7) and the number of bytes encoded.
-- `id` is taken modulo 65536; `payload` is a byte string (UTF-8 passes through).
function C.Encode(id, payload)
	local len = #payload
	assert(len <= C.MAX_PAYLOAD, "WCH_Codec.Encode: payload too long")
	id = id % 65536
	local bytes = {
		C.MAGIC1, C.MAGIC2,
		math.floor(id / 256) % 256, id % 256,
		math.floor(len / 256) % 256, len % 256,
	}
	for i = 1, len do
		bytes[#bytes + 1] = payload:byte(i)
	end
	local s1, s2 = C.Fletcher16(bytes, 3, 6 + len)
	bytes[#bytes + 1] = s1
	bytes[#bytes + 1] = s2

	local BITS = C.BITS
	local base = 2 ^ BITS
	local cells = {}
	local acc, nbits = 0, 0
	for i = 1, #bytes do
		acc = acc * 256 + bytes[i]
		nbits = nbits + 8
		while nbits >= BITS do
			local shift = nbits - BITS
			cells[#cells + 1] = math.floor(acc / 2 ^ shift) % base
			nbits = shift
			acc = acc % 2 ^ nbits
		end
	end
	if nbits > 0 then
		cells[#cells + 1] = (acc * 2 ^ (BITS - nbits)) % base
	end
	return cells, #bytes
end

-- Color for a cell value: each channel fully on or off.
function C.CellColor(v)
	local r = math.floor(v / 4) % 2
	local g = math.floor(v / 2) % 2
	local b = v % 2
	return r, g, b
end

-- Cell index (0-based) -> column, row (0-based) on the strip.
function C.CellPos(i)
	return i % C.CELLS_PER_ROW, math.floor(i / C.CELLS_PER_ROW)
end
