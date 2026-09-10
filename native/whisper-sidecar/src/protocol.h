#pragma once

#include <cstdint>
#include <vector>
#include <iostream>
#include <string>

namespace sidecar {

enum class MessageType : uint8_t {
    AUDIO_FRAME = 0x01,
    FLUSH = 0x02,
    CLOSE = 0x03
};

struct Frame {
    MessageType type;
    std::vector<uint8_t> payload;
};

// Đọc chính xác N bytes từ stream
inline bool read_exact(std::istream& in, uint8_t* buffer, size_t size) {
    size_t total_read = 0;
    while (total_read < size) {
        in.read(reinterpret_cast<char*>(buffer + total_read), size - total_read);
        std::streamsize bytes_read = in.gcount();
        if (bytes_read <= 0) {
            return false;
        }
        total_read += static_cast<size_t>(bytes_read);
    }
    return true;
}

// Đọc 1 frame từ stdin: [1 byte type][4 bytes uint32_be length][payload]
inline bool read_frame(std::istream& in, Frame& frame) {
    uint8_t header[5];
    if (!read_exact(in, header, 5)) {
        return false;
    }

    frame.type = static_cast<MessageType>(header[0]);
    uint32_t length = (static_cast<uint32_t>(header[1]) << 24) |
                      (static_cast<uint32_t>(header[2]) << 16) |
                      (static_cast<uint32_t>(header[3]) << 8)  |
                      static_cast<uint32_t>(header[4]);

    frame.payload.resize(length);
    if (length > 0) {
        if (!read_exact(in, frame.payload.data(), length)) {
            return false;
        }
    }
    return true;
}

// Gửi event NDJSON ra stdout
inline void emit_ndjson(const std::string& json_str) {
    std::cout << json_str << "\n";
    std::cout.flush();
}

} // namespace sidecar
