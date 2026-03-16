import asyncio
import inspect
from google import genai
from google.genai import types

class GeminiLive:
    """
    Handles the interaction with the Gemini Live API using the official SDK.
    """
    def __init__(self, project_id, location, model, input_sample_rate, tools=None, tool_mapping=None):
        self.project_id = project_id
        self.location = location
        self.model = model
        self.input_sample_rate = input_sample_rate
        self.client = genai.Client(vertexai=True, project=project_id, location=location)
        self.tools = tools or []
        self.tool_mapping = tool_mapping or {}

    async def start_session(self, audio_input_queue, video_input_queue, text_input_queue, audio_output_callback, audio_interrupt_callback=None):
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            ),
            system_instruction=types.Content(parts=[types.Part(text="You are a professional Dietitian's Assistant. Be concise, friendly, and encouraging. Use your knowledge to guide the user's nutrition.")]),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            proactivity=types.ProactivityConfig(proactive_audio=True),
            tools=self.tools,
        )
        
        async with self.client.aio.live.connect(model=self.model, config=config) as session:
            
            async def send_audio():
                try:
                    while True:
                        chunk = await audio_input_queue.get()
                        await session.send_realtime_input(
                            audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={self.input_sample_rate}")
                        )
                except asyncio.CancelledError:
                    pass

            async def send_video():
                try:
                    while True:
                        chunk = await video_input_queue.get()
                        await session.send_realtime_input(
                            video=types.Blob(data=chunk, mime_type="image/jpeg")
                        )
                except asyncio.CancelledError:
                    pass

            async def send_text():
                try:
                    while True:
                        text = await text_input_queue.get()
                        await session.send(input=text, end_of_turn=True)
                except asyncio.CancelledError:
                    pass

            event_queue = asyncio.Queue()

            async def receive_loop():
                try:
                    while True:
                        async for response in session.receive():
                            server_content = response.server_content
                            tool_call = response.tool_call
                            
                            if server_content:
                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.inline_data:
                                            await audio_output_callback(part.inline_data.data)
                                        if part.text:
                                            # Sometimes Gemini sends text parts instead of/with audio
                                            await event_queue.put({"type": "gemini", "text": part.text})
                                
                                if server_content.input_transcription and server_content.input_transcription.text:
                                    # print(f"User: {server_content.input_transcription.text}")
                                    await event_queue.put({"type": "user", "text": server_content.input_transcription.text})
                                
                                if server_content.output_transcription and server_content.output_transcription.text:
                                    # print(f"Gemini: {server_content.output_transcription.text}")
                                    await event_queue.put({"type": "gemini", "text": server_content.output_transcription.text})
                                
                                if server_content.turn_complete:
                                    await event_queue.put({"type": "turn_complete"})
                                
                                if server_content.interrupted:
                                    if audio_interrupt_callback:
                                        await audio_interrupt_callback()
                                    await event_queue.put({"type": "interrupted"})

                            if tool_call:
                                # Simple tool handling
                                for fc in tool_call.function_calls:
                                    await event_queue.put({"type": "tool_call", "name": fc.name, "args": fc.args})
                                    # For now we send a dummy response to keep session alive
                                    await session.send_tool_response(function_responses=[
                                        types.FunctionResponse(name=fc.name, id=fc.id, response={"result": "OK"})
                                    ])

                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    import traceback
                    print(f"CRITICAL SDK ERROR: {e}")
                    traceback.print_exc()
                    await event_queue.put({"type": "error", "error": str(e)})
                finally:
                    await event_queue.put(None)

            tasks = [
                asyncio.create_task(send_audio()),
                asyncio.create_task(send_video()),
                asyncio.create_task(send_text()),
                asyncio.create_task(receive_loop())
            ]

            try:
                while True:
                    event = await event_queue.get()
                    if event is None: break
                    yield event
            finally:
                for t in tasks: t.cancel()
