cmake_minimum_required(VERSION 3.22.1)
project(corpusplayer C)
add_library(corpusplayer SHARED corpus_player.c)
target_link_libraries(corpusplayer log dl)
