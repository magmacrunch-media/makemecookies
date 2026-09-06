Raw signed 16-bit little-endian PCM, embedded by bin2s and reachable as
`<name>_pcm` / `<name>_pcm_size` from `assets.h`.

`music.pcm` is produced by `tools/convert-audio.sh` from the web game's ogg. It
is the whole track rather than a loop, because a round is exactly one play of
it -- and its byte count is where the shift length comes from. Read that script
before replacing it.
