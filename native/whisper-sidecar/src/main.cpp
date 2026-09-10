#include "protocol.h"
#include "whisper.h"

#include <algorithm>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

static std::string json_escape(const std::string& value) {
    std::ostringstream escaped;
    for (const unsigned char character : value) {
        switch (character) {
            case '\\': escaped << "\\\\"; break;
            case '"': escaped << "\\\""; break;
            case '\n': escaped << "\\n"; break;
            case '\r': escaped << "\\r"; break;
            case '\t': escaped << "\\t"; break;
            default:
                if (character < 0x20) {
                    escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                            << static_cast<int>(character);
                } else {
                    escaped << character;
                }
        }
    }
    return escaped.str();
}

static std::vector<float> pcm16_to_float(const std::vector<uint8_t>& pcm) {
    const size_t sample_count = pcm.size() / 2;
    std::vector<float> samples(sample_count);
    for (size_t index = 0; index < sample_count; ++index) {
        const int16_t sample = static_cast<int16_t>(
            static_cast<uint16_t>(pcm[index * 2]) |
            (static_cast<uint16_t>(pcm[index * 2 + 1]) << 8));
        samples[index] = static_cast<float>(sample) / 32768.0f;
    }
    return samples;
}

static void transcribe_audio(
    whisper_context* context,
    const std::vector<uint8_t>& audio,
    const std::string& language,
    int& segment_index
) {
    if (audio.size() < 3200) {
        return;
    }

    const std::vector<float> samples = pcm16_to_float(audio);
    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.no_timestamps = true;
    params.single_segment = false;
    params.no_context = true;
    params.language = language.c_str();
    params.n_threads = static_cast<int>(std::max(1u, std::min(8u, std::thread::hardware_concurrency())));
    params.temperature_inc = 0.0f;

    if (whisper_full(context, params, samples.data(), static_cast<int>(samples.size())) != 0) {
        sidecar::emit_ndjson("{\"type\":\"error\",\"message\":\"Whisper không xử lý được audio.\"}");
        return;
    }

    std::string transcript;
    const int count = whisper_full_n_segments(context);
    for (int index = 0; index < count; ++index) {
        if (!transcript.empty()) {
            transcript += " ";
        }
        transcript += whisper_full_get_segment_text(context, index);
    }

    sidecar::emit_ndjson(
        "{\"type\":\"completed\",\"itemId\":\"seg-" +
        std::to_string(segment_index) + "\",\"order\":" +
        std::to_string(segment_index++) + ",\"transcript\":\"" +
        json_escape(transcript) + "\"}"
    );
}

int main(int argc, char** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_TEXT);
#endif

    std::string model_path;
    std::string language = "vi";

    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--model" && index + 1 < argc) {
            model_path = argv[++index];
        } else if (argument == "--language" && index + 1 < argc) {
            language = argv[++index];
        } else if (argument == "--prompt" && index + 1 < argc) {
            ++index;
        }
    }

    if (model_path.empty()) {
        sidecar::emit_ndjson("{\"type\":\"error\",\"message\":\"Thiếu đường dẫn model Whisper.\"}");
        return 2;
    }

    whisper_context_params context_params = whisper_context_default_params();
    whisper_context* context = whisper_init_from_file_with_params(model_path.c_str(), context_params);
    if (context == nullptr) {
        sidecar::emit_ndjson("{\"type\":\"error\",\"message\":\"Không thể nạp model Whisper.\"}");
        return 3;
    }

    sidecar::emit_ndjson(
        "{\"type\":\"ready\",\"model\":\"" + json_escape(model_path) +
        "\",\"language\":\"" + json_escape(language) + "\"}"
    );

    sidecar::Frame frame;
    std::vector<uint8_t> audio;
    int segment_index = 1;

    while (sidecar::read_frame(std::cin, frame)) {
        if (frame.type == sidecar::MessageType::CLOSE) {
            break;
        }
        if (frame.type == sidecar::MessageType::AUDIO_FRAME) {
            audio.insert(audio.end(), frame.payload.begin(), frame.payload.end());
            continue;
        }
        if (frame.type == sidecar::MessageType::FLUSH) {
            transcribe_audio(context, audio, language, segment_index);
            audio.clear();
            sidecar::emit_ndjson("{\"type\":\"flush-completed\"}");
        }
    }

    whisper_free(context);
    return 0;
}
