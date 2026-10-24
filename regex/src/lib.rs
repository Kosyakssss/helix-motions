use regex_cursor::engines::meta::{Builder, Regex};
use regex_cursor::regex_automata::util::syntax::Config;
use regex_cursor::Input;

static mut ERROR: Vec<u8> = Vec::new();

#[no_mangle]
pub extern "C" fn rx_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buffer.as_mut_ptr();
    core::mem::forget(buffer);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn rx_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

#[no_mangle]
pub unsafe extern "C" fn rx_compile(ptr: *const u8, len: usize, case_insensitive: u32, crlf: u32) -> *mut Regex {
    let pattern = core::str::from_utf8_unchecked(core::slice::from_raw_parts(ptr, len));
    let built = Builder::new()
        .syntax(
            Config::new()
                .case_insensitive(case_insensitive != 0)
                .multi_line(true)
                .crlf(crlf != 0),
        )
        .build(pattern);
    match built {
        Ok(regex) => Box::into_raw(Box::new(regex)),
        Err(err) => {
            ERROR = err.to_string().into_bytes();
            core::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn rx_error_ptr() -> *const u8 {
    (*core::ptr::addr_of!(ERROR)).as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn rx_error_len() -> usize {
    (*core::ptr::addr_of!(ERROR)).len()
}

#[no_mangle]
pub unsafe extern "C" fn rx_drop(regex: *mut Regex) {
    drop(Box::from_raw(regex));
}

unsafe fn haystack<'a>(ptr: *const u8, len: usize) -> &'a str {
    core::str::from_utf8_unchecked(core::slice::from_raw_parts(ptr, len))
}

#[no_mangle]
pub unsafe extern "C" fn rx_find(regex: *const Regex, ptr: *const u8, len: usize, start: usize, end: usize, out: *mut u32) -> u32 {
    let input = Input::new(haystack(ptr, len)).range(start..end);
    match (*regex).find(input) {
        Some(m) => {
            *out = m.start() as u32;
            *out.add(1) = m.end() as u32;
            1
        }
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn rx_find_last(regex: *const Regex, ptr: *const u8, len: usize, start: usize, end: usize, out: *mut u32) -> u32 {
    let input = Input::new(haystack(ptr, len)).range(start..end);
    match (*regex).find_iter(input).last() {
        Some(m) => {
            *out = m.start() as u32;
            *out.add(1) = m.end() as u32;
            1
        }
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn rx_find_all(
    regex: *const Regex,
    ptr: *const u8,
    len: usize,
    start: usize,
    end: usize,
    out: *mut u32,
    capacity: usize,
) -> usize {
    let input = Input::new(haystack(ptr, len)).range(start..end);
    let mut count = 0;
    for m in (*regex).find_iter(input) {
        if count < capacity {
            *out.add(count * 2) = m.start() as u32;
            *out.add(count * 2 + 1) = m.end() as u32;
        }
        count += 1;
    }
    count
}

#[no_mangle]
pub unsafe extern "C" fn rx_is_match(regex: *const Regex, ptr: *const u8, len: usize, start: usize, end: usize) -> u32 {
    (*regex).is_match(Input::new(haystack(ptr, len)).range(start..end)) as u32
}
